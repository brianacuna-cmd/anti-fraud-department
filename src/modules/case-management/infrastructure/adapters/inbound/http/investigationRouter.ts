import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createOpenInvestigationUseCase } from '../../../../application/OpenInvestigation.js';
import type { createListInvestigationsUseCase } from '../../../../application/ListInvestigations.js';
import type { createGetInvestigationUseCase } from '../../../../application/GetInvestigation.js';
import type { createCloseInvestigationUseCase } from '../../../../application/CloseInvestigation.js';
import type { createUpdateInvestigationFindingsUseCase } from '../../../../application/UpdateInvestigationFindings.js';
import type { createLinkInvestigationCasesUseCase } from '../../../../application/LinkInvestigationCases.js';
import type { createListActiveInvestigationsUseCase } from '../../../../application/ListActiveInvestigations.js';
import type { createUpdateInvestigationStatusUseCase } from '../../../../application/UpdateInvestigationStatus.js';
import type { createBuildEntityNetworkGraphUseCase } from '../../../../application/BuildEntityNetworkGraph.js';
import type { createExportInvestigationSummaryUseCase } from '../../../../application/ExportInvestigationSummary.js';
import type { createExportInvestigationUseCase } from '../../../../application/ExportInvestigation.js';
import {
  openInvestigationSchema,
  closeInvestigationSchema,
  updateInvestigationFindingsSchema,
  linkInvestigationCasesSchema,
  updateInvestigationStatusSchema,
  entityNetworkGraphQuerySchema,
} from './dto/investigationSchemas.js';
import { toInvestigationResponse } from './mappers/InvestigationHttpMapper.js';
import { toCaseReportResponse } from './mappers/CaseReportHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface InvestigationRouterDeps {
  readonly openInvestigation: ReturnType<typeof createOpenInvestigationUseCase>;
  readonly listInvestigations: ReturnType<typeof createListInvestigationsUseCase>;
  readonly getInvestigation: ReturnType<typeof createGetInvestigationUseCase>;
  readonly closeInvestigation: ReturnType<typeof createCloseInvestigationUseCase>;
  readonly updateInvestigationFindings: ReturnType<typeof createUpdateInvestigationFindingsUseCase>;
  readonly linkInvestigationCases: ReturnType<typeof createLinkInvestigationCasesUseCase>;
  readonly listActiveInvestigations: ReturnType<typeof createListActiveInvestigationsUseCase>;
  readonly updateInvestigationStatus: ReturnType<typeof createUpdateInvestigationStatusUseCase>;
  readonly buildEntityNetworkGraph: ReturnType<typeof createBuildEntityNetworkGraphUseCase>;
  readonly exportInvestigationSummary: ReturnType<typeof createExportInvestigationSummaryUseCase>;
  readonly exportInvestigation: ReturnType<typeof createExportInvestigationUseCase>;
}

/**
 * Investigation routes (separate router so the busy `caseRouter` deps stay
 * stable): POST/GET /cases/:caseId/investigations and GET /investigations/:id.
 * Mounted on the same authenticated /api/v1 router as `caseRouter`.
 */
export function investigationRouter(deps: InvestigationRouterDeps): Router {
  const router = Router();

  router.post('/cases/:caseId/investigations', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(openInvestigationSchema, req.body);
    const investigation = await deps.openInvestigation({
      auth,
      caseId: req.params.caseId!,
      subjectType: body.subjectType,
      subjectId: body.subjectId,
    });
    res.status(201).json(toInvestigationResponse(investigation));
  });

  router.get('/cases/:caseId/investigations', async (req, res) => {
    const auth = requireAuthContext(req);
    const items = await deps.listInvestigations({ auth, caseId: req.params.caseId! });
    res.status(200).json({ items: items.map(toInvestigationResponse) });
  });

  router.get('/investigations', async (req, res) => {
    const auth = requireAuthContext(req);
    const items = await deps.listActiveInvestigations({ auth });
    res.status(200).json({ items: items.map(toInvestigationResponse) });
  });

  // INV-014. Before `/investigations/:investigationId`, for the same reason
  // as the graph: that pattern would swallow "summary" as if it were an id.
  router.get('/investigations/:investigationId/summary', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(entityNetworkGraphQuerySchema, req.query);
    const summary = await deps.exportInvestigationSummary({
      auth,
      investigationId: req.params.investigationId!,
      ...(query.maxDepth === undefined ? {} : { maxDepth: query.maxDepth }),
    });
    res.status(200).json(summary);
  });

  // INV-014, same report as `/summary` but frozen in `case_reports`.
  // It is a write, not a query; it is left as GET because what it produces is
  // a document and the caller expects to download it, but it is not idempotent:
  // each call leaves a new report, and that is the point — the history of
  // what was delivered, and when.
  router.get('/investigations/:investigationId/export', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(entityNetworkGraphQuerySchema, req.query);
    const report = await deps.exportInvestigation({
      auth,
      investigationId: req.params.investigationId!,
      ...(query.maxDepth === undefined ? {} : { maxDepth: query.maxDepth }),
    });
    res.status(200).json(toCaseReportResponse(report));
  });

  // Before `/investigations/:investigationId`: Express matches by order and
  // that pattern would swallow "graph" as if it were an id.
  router.get('/investigations/:investigationId/graph', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(entityNetworkGraphQuerySchema, req.query);
    const graph = await deps.buildEntityNetworkGraph({
      auth,
      investigationId: req.params.investigationId!,
      ...(query.maxDepth === undefined ? {} : { maxDepth: query.maxDepth }),
    });
    res.status(200).json(graph);
  });

  router.get('/investigations/:investigationId', async (req, res) => {
    const auth = requireAuthContext(req);
    const investigation = await deps.getInvestigation({
      auth,
      investigationId: req.params.investigationId!,
    });
    res.status(200).json(toInvestigationResponse(investigation));
  });

  router.post('/cases/:caseId/investigations/:investigationId/close', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(closeInvestigationSchema, req.body);
    const investigation = await deps.closeInvestigation({
      auth,
      investigationId: req.params.investigationId!,
      findings: body.findings,
    });
    res.status(200).json(toInvestigationResponse(investigation));
  });

  router.patch('/investigations/:investigationId/status', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(updateInvestigationStatusSchema, req.body);
    const investigation = await deps.updateInvestigationStatus({
      auth,
      investigationId: req.params.investigationId!,
      status: body.status,
    });
    res.status(200).json(toInvestigationResponse(investigation));
  });

  router.patch('/investigations/:investigationId/findings', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(updateInvestigationFindingsSchema, req.body);
    const investigation = await deps.updateInvestigationFindings({
      auth,
      investigationId: req.params.investigationId!,
      findings: body.findings,
      explorationDepth: body.explorationDepth,
    });
    res.status(200).json(toInvestigationResponse(investigation));
  });

  router.post('/investigations/:investigationId/link-cases', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(linkInvestigationCasesSchema, req.body);
    const investigation = await deps.linkInvestigationCases({
      auth,
      investigationId: req.params.investigationId!,
      caseIds: body.caseIds,
    });
    res.status(200).json(toInvestigationResponse(investigation));
  });

  return router;
}

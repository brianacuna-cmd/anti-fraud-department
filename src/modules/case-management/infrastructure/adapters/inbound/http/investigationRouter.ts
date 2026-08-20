import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createOpenInvestigationUseCase } from '../../../../application/OpenInvestigation.js';
import type { createListInvestigationsUseCase } from '../../../../application/ListInvestigations.js';
import type { createGetInvestigationUseCase } from '../../../../application/GetInvestigation.js';
import type { createCloseInvestigationUseCase } from '../../../../application/CloseInvestigation.js';
import type { createUpdateInvestigationFindingsUseCase } from '../../../../application/UpdateInvestigationFindings.js';
import type { createLinkInvestigationCasesUseCase } from '../../../../application/LinkInvestigationCases.js';
import {
  openInvestigationSchema,
  closeInvestigationSchema,
  updateInvestigationFindingsSchema,
  linkInvestigationCasesSchema,
} from './dto/investigationSchemas.js';
import { toInvestigationResponse } from './mappers/InvestigationHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface InvestigationRouterDeps {
  readonly openInvestigation: ReturnType<typeof createOpenInvestigationUseCase>;
  readonly listInvestigations: ReturnType<typeof createListInvestigationsUseCase>;
  readonly getInvestigation: ReturnType<typeof createGetInvestigationUseCase>;
  readonly closeInvestigation: ReturnType<typeof createCloseInvestigationUseCase>;
  readonly updateInvestigationFindings: ReturnType<typeof createUpdateInvestigationFindingsUseCase>;
  readonly linkInvestigationCases: ReturnType<typeof createLinkInvestigationCasesUseCase>;
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

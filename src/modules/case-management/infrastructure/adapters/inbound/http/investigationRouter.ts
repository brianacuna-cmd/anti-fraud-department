import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createOpenInvestigationUseCase } from '../../../../application/OpenInvestigation.js';
import type { createListInvestigationsUseCase } from '../../../../application/ListInvestigations.js';
import type { createGetInvestigationUseCase } from '../../../../application/GetInvestigation.js';
import { openInvestigationSchema } from './dto/investigationSchemas.js';
import { toInvestigationResponse } from './mappers/InvestigationHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface InvestigationRouterDeps {
  readonly openInvestigation: ReturnType<typeof createOpenInvestigationUseCase>;
  readonly listInvestigations: ReturnType<typeof createListInvestigationsUseCase>;
  readonly getInvestigation: ReturnType<typeof createGetInvestigationUseCase>;
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

  return router;
}

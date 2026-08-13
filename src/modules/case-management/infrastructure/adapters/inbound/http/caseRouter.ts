import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateCaseUseCase } from '../../../../application/CreateCase.js';
import type { createReassignCaseUseCase } from '../../../../application/ReassignCase.js';
import { createCaseSchema, reassignCaseSchema } from './dto/caseSchemas.js';
import { toCaseResponse } from './mappers/CaseHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface CaseRouterDeps {
  readonly createCase: ReturnType<typeof createCreateCaseUseCase>;
  readonly reassignCase: ReturnType<typeof createReassignCaseUseCase>;
}

/**
 * `/cases` routes (design: "infrastructure/adapters/inbound/http/
 * caseRouter"). POST /cases (create) + POST /cases/:caseId/reassign
 * (manual reassignment). Express 5 forwards a rejected handler promise to
 * `errorHandler` automatically — no manual try/catch needed here.
 */
export function caseRouter(deps: CaseRouterDeps): Router {
  const router = Router();

  router.post('/cases', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createCaseSchema, req.body);
    const kase = await deps.createCase({ auth, ...body });
    res.status(201).json(toCaseResponse(kase));
  });

  router.post('/cases/:caseId/reassign', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(reassignCaseSchema, req.body);
    const kase = await deps.reassignCase({
      auth,
      caseId: req.params.caseId!,
      assignedToType: body.assignedToType,
      assignedToId: body.assignedToId,
    });
    res.status(200).json(toCaseResponse(kase));
  });

  return router;
}

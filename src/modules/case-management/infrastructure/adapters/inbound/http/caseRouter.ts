import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateCaseUseCase } from '../../../../application/CreateCase.js';
import { createCaseSchema } from './dto/caseSchemas.js';
import { toCaseResponse } from './mappers/CaseHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface CaseRouterDeps {
  readonly createCase: ReturnType<typeof createCreateCaseUseCase>;
}

/**
 * `/cases` routes (design: "infrastructure/adapters/inbound/http/
 * caseRouter"). Slice 5 — only `POST /cases` (T5 manual creation) exists
 * yet; `GET /cases` (T3 inbox) lands in Slice 10. Express 5 forwards a
 * rejected handler promise to `errorHandler` automatically — no manual
 * try/catch needed here (mirrors `organizationRouter`).
 */
export function caseRouter(deps: CaseRouterDeps): Router {
  const router = Router();

  router.post('/cases', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createCaseSchema, req.body);
    const kase = await deps.createCase({ auth, ...body });
    res.status(201).json(toCaseResponse(kase));
  });

  return router;
}

import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateCaseUseCase } from '../../../../application/CreateCase.js';
import type { createReassignCaseUseCase } from '../../../../application/ReassignCase.js';
import type { createListCasesUseCase } from '../../../../application/ListCases.js';
import type { createReopenCaseUseCase } from '../../../../application/ReopenCase.js';
import type { createGetCaseUseCase } from '../../../../application/GetCase.js';
import type { createGetCaseTimelineUseCase } from '../../../../application/GetCaseTimeline.js';
import {
  createCaseSchema,
  reassignCaseSchema,
  listCasesQuerySchema,
  reopenCaseSchema,
} from './dto/caseSchemas.js';
import { toCaseResponse } from './mappers/CaseHttpMapper.js';
import { toTimelineEventResponse } from './mappers/CaseTimelineHttpMapper.js';
import { parseRequest } from './parseRequest.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';

export interface CaseRouterDeps {
  readonly createCase: ReturnType<typeof createCreateCaseUseCase>;
  readonly reassignCase: ReturnType<typeof createReassignCaseUseCase>;
  readonly listCases: ReturnType<typeof createListCasesUseCase>;
  readonly reopenCase: ReturnType<typeof createReopenCaseUseCase>;
  readonly getCase: ReturnType<typeof createGetCaseUseCase>;
  readonly getCaseTimeline: ReturnType<typeof createGetCaseTimelineUseCase>;
}

/**
 * `/cases` routes: POST /cases (create), GET /cases (inbox),
 * POST /cases/:caseId/reassign (manual reassignment),
 * POST /cases/:caseId/reopen (role-gated reopen). Express 5 forwards a
 * rejected handler promise to `errorHandler` automatically.
 */
export function caseRouter(deps: CaseRouterDeps): Router {
  const router = Router();

  router.get('/cases', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(listCasesQuerySchema, req.query);
    const page = await deps.listCases({
      auth,
      status: query.status,
      priority: query.priority,
      assignedToId: query.assignedTo,
      riskScoreMin: query.riskScoreMin,
      riskScoreMax: query.riskScoreMax,
      tags: query.tags,
      dueAfter: query.dueAfter as Instant | undefined,
      dueBefore: query.dueBefore as Instant | undefined,
      limit: query.limit,
      offset: query.offset,
    });
    res.status(200).json({
      items: page.items.map(toCaseResponse),
      total: page.total,
    });
  });

  router.post('/cases', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createCaseSchema, req.body);
    const kase = await deps.createCase({ auth, ...body });
    res.status(201).json(toCaseResponse(kase));
  });

  router.get('/cases/:caseId', async (req, res) => {
    const auth = requireAuthContext(req);
    const kase = await deps.getCase({ auth, caseId: req.params.caseId! });
    res.status(200).json(toCaseResponse(kase));
  });

  router.get('/cases/:caseId/timeline', async (req, res) => {
    const auth = requireAuthContext(req);
    const events = await deps.getCaseTimeline({ auth, caseId: req.params.caseId! });
    res.status(200).json({ items: events.map(toTimelineEventResponse) });
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

  router.post('/cases/:caseId/reopen', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(reopenCaseSchema, req.body);
    const kase = await deps.reopenCase({
      auth,
      caseId: req.params.caseId!,
      targetStatus: body.targetStatus,
      justification: body.justification,
    });
    res.status(200).json(toCaseResponse(kase));
  });

  return router;
}

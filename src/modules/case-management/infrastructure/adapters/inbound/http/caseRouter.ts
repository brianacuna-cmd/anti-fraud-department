import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateCaseUseCase } from '../../../../application/CreateCase.js';
import type { createReassignCaseUseCase } from '../../../../application/ReassignCase.js';
import type { createListCasesUseCase } from '../../../../application/ListCases.js';
import type { createReopenCaseUseCase } from '../../../../application/ReopenCase.js';
import type { createUpdateCasePriorityTagsUseCase } from '../../../../application/UpdateCasePriorityTags.js';
import type { createBulkCaseActionUseCase } from '../../../../application/BulkCaseAction.js';
import type { createGetCaseUseCase } from '../../../../application/GetCase.js';
import type { createGetCaseTimelineUseCase } from '../../../../application/GetCaseTimeline.js';
import type { createAddCaseNoteUseCase } from '../../../../application/AddCaseNote.js';
import type { createListCaseNotesUseCase } from '../../../../application/ListCaseNotes.js';
import type { createResolveCaseUseCase } from '../../../../application/ResolveCase.js';
import type { createArchiveCaseUseCase } from '../../../../application/ArchiveCase.js';
import type { createStartReviewUseCase } from '../../../../application/StartReview.js';
import {
  createCaseSchema,
  reassignCaseSchema,
  listCasesQuerySchema,
  reopenCaseSchema,
  updateCasePriorityTagsSchema,
  bulkCaseActionSchema,
  addCaseNoteSchema,
  closeCaseSchema,
} from './dto/caseSchemas.js';
import { toCaseResponse } from './mappers/CaseHttpMapper.js';
import { toTimelineEventResponse } from './mappers/CaseTimelineHttpMapper.js';
import { toCaseNoteResponse } from './mappers/CaseNoteHttpMapper.js';
import { parseRequest } from './parseRequest.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';

export interface CaseRouterDeps {
  readonly createCase: ReturnType<typeof createCreateCaseUseCase>;
  readonly reassignCase: ReturnType<typeof createReassignCaseUseCase>;
  readonly listCases: ReturnType<typeof createListCasesUseCase>;
  readonly reopenCase: ReturnType<typeof createReopenCaseUseCase>;
  readonly updateCasePriorityTags: ReturnType<typeof createUpdateCasePriorityTagsUseCase>;
  readonly bulkCaseAction: ReturnType<typeof createBulkCaseActionUseCase>;
  readonly getCase: ReturnType<typeof createGetCaseUseCase>;
  readonly getCaseTimeline: ReturnType<typeof createGetCaseTimelineUseCase>;
  readonly addCaseNote: ReturnType<typeof createAddCaseNoteUseCase>;
  readonly listCaseNotes: ReturnType<typeof createListCaseNotesUseCase>;
  readonly resolveCase: ReturnType<typeof createResolveCaseUseCase>;
  readonly archiveCase: ReturnType<typeof createArchiveCaseUseCase>;
  readonly startReview: ReturnType<typeof createStartReviewUseCase>;
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

  router.post('/cases/bulk-action', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(bulkCaseActionSchema, req.body);
    const result = await deps.bulkCaseAction({
      auth,
      caseIds: body.caseIds,
      action: body.action,
    });
    res.status(200).json({
      items: result.cases.map(toCaseResponse),
      changedCaseIds: result.changedCaseIds,
    });
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

  router.post('/cases/:caseId/notes', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(addCaseNoteSchema, req.body);
    const note = await deps.addCaseNote({ auth, caseId: req.params.caseId!, body: body.body });
    res.status(201).json(toCaseNoteResponse(note));
  });

  router.get('/cases/:caseId/notes', async (req, res) => {
    const auth = requireAuthContext(req);
    const notes = await deps.listCaseNotes({ auth, caseId: req.params.caseId! });
    res.status(200).json({ items: notes.map(toCaseNoteResponse) });
  });

  router.post('/cases/:caseId/start-review', async (req, res) => {
    const auth = requireAuthContext(req);
    const kase = await deps.startReview({ auth, caseId: req.params.caseId! });
    res.status(200).json(toCaseResponse(kase));
  });

  router.post('/cases/:caseId/resolve', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(closeCaseSchema, req.body);
    const kase = await deps.resolveCase({ auth, caseId: req.params.caseId!, reason: body.reason });
    res.status(200).json(toCaseResponse(kase));
  });

  router.post('/cases/:caseId/archive', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(closeCaseSchema, req.body);
    const kase = await deps.archiveCase({ auth, caseId: req.params.caseId!, reason: body.reason });
    res.status(200).json(toCaseResponse(kase));
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

  router.patch('/cases/:caseId/priority-tags', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(updateCasePriorityTagsSchema, req.body);
    const kase = await deps.updateCasePriorityTags({
      auth,
      caseId: req.params.caseId!,
      priority: body.priority,
      tags: body.tags,
    });
    res.status(200).json(toCaseResponse(kase));
  });

  return router;
}

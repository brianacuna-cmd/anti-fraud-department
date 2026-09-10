import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { Clock } from '../../../../../../shared/time/Clock.js';
import { createPrivacyDataRequestId } from '../../../../domain/model/value-objects/PrivacyDataRequestId.js';
import type { createIngestPrivacyRequestUseCase } from '../../../../application/IngestPrivacyRequest.js';
import type { createExportSubjectDataUseCase } from '../../../../application/ExportSubjectData.js';
import type { createAnonymizeSubjectDataUseCase } from '../../../../application/AnonymizeSubjectData.js';
import type { createResolvePrivacyRequestUseCase } from '../../../../application/ResolvePrivacyRequest.js';
import type { createListPrivacyRequestsUseCase } from '../../../../application/ListPrivacyRequests.js';
import type { createGetPrivacyRequestUseCase } from '../../../../application/GetPrivacyRequest.js';
import {
  ingestPrivacyRequestSchema,
  listPrivacyRequestsQuerySchema,
  resolvePrivacyRequestSchema,
} from './dto/privacyRequestSchemas.js';
import { toPrivacyDataRequestResponse } from './mappers/PrivacyDataRequestHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface PrivacyRequestRouterDeps {
  readonly ingestPrivacyRequest: ReturnType<typeof createIngestPrivacyRequestUseCase>;
  readonly exportSubjectData: ReturnType<typeof createExportSubjectDataUseCase>;
  readonly anonymizeSubjectData: ReturnType<typeof createAnonymizeSubjectDataUseCase>;
  readonly resolvePrivacyRequest: ReturnType<typeof createResolvePrivacyRequestUseCase>;
  readonly listPrivacyRequests: ReturnType<typeof createListPrivacyRequestsUseCase>;
  readonly getPrivacyRequest: ReturnType<typeof createGetPrivacyRequestUseCase>;
  readonly clock: Clock;
}

/** Normalizes zod's `string | string[]` for repeatable query params. */
function asArray<T>(value: T | T[] | undefined): readonly T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

/**
 * `/privacy-requests` routes (PRIV-001 to PRIV-004). Express 5 forwards
 * rejected handler promises to `errorHandler`.
 */
export function privacyRequestRouter(deps: PrivacyRequestRouterDeps): Router {
  const router = Router();

  // PRIV-001
  router.post('/privacy-requests', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(ingestPrivacyRequestSchema, req.body);
    const request = await deps.ingestPrivacyRequest({
      auth,
      subjectEmail: body.subjectEmail,
      subjectCustomerId: body.subjectCustomerId,
      type: body.type,
      requesterNote: body.requesterNote,
    });
    res.status(201).json(toPrivacyDataRequestResponse(request, deps.clock.now()));
  });

  router.get('/privacy-requests', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(listPrivacyRequestsQuerySchema, req.query);
    const page = await deps.listPrivacyRequests({
      auth,
      status: asArray(query.status),
      type: asArray(query.type),
      limit: query.limit,
      offset: query.offset,
    });
    const now = deps.clock.now();
    res.status(200).json({
      items: page.items.map((r) => toPrivacyDataRequestResponse(r, now)),
      total: page.total,
    });
  });

  router.get('/privacy-requests/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const request = await deps.getPrivacyRequest({
      auth,
      requestId: createPrivacyDataRequestId(req.params.id!),
    });
    res.status(200).json(toPrivacyDataRequestResponse(request, deps.clock.now()));
  });

  /*
   * PRIV-002. A GET that writes an audit entry, which looks wrong and is not:
   * assembling somebody's personal file is a disclosure, and a disclosure
   * that leaves no trace is the failure this endpoint exists to avoid. The
   * response is not cacheable and says so.
   */
  router.get('/privacy-requests/:id/export', async (req, res) => {
    const auth = requireAuthContext(req);
    const pkg = await deps.exportSubjectData({
      auth,
      requestId: createPrivacyDataRequestId(req.params.id!),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(pkg);
  });

  // PRIV-003
  router.post('/privacy-requests/:id/anonymize', async (req, res) => {
    const auth = requireAuthContext(req);
    const result = await deps.anonymizeSubjectData({
      auth,
      requestId: createPrivacyDataRequestId(req.params.id!),
    });
    res.status(200).json(result);
  });

  // PRIV-004
  router.patch('/privacy-requests/:id/resolve', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(resolvePrivacyRequestSchema, req.body);
    const { request, certificate } = await deps.resolvePrivacyRequest({
      auth,
      requestId: createPrivacyDataRequestId(req.params.id!),
      resolution: body.resolution,
      note: body.note,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      request: toPrivacyDataRequestResponse(request, deps.clock.now()),
      // Returned once, here. Only its hash is persisted — see the use case.
      certificate,
    });
  });

  return router;
}

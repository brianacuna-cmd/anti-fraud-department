import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import { parsePaginationParams } from '../../../../../../shared/http/pagination.js';
import type { createListDlqEventsUseCase } from '../../../../application/ListDlqEvents.js';
import type { createGetDlqEventUseCase } from '../../../../application/GetDlqEvent.js';
import type { createRequeueDlqEventUseCase } from '../../../../application/RequeueDlqEvent.js';
import { toDlqListItem, toDlqInspectDto } from './mappers/DlqEventHttpMapper.js';

export interface DlqAdminRouterDeps {
  readonly listDlqEvents: ReturnType<typeof createListDlqEventsUseCase>;
  readonly getDlqEvent: ReturnType<typeof createGetDlqEventUseCase>;
  readonly requeueDlqEvent: ReturnType<typeof createRequeueDlqEventUseCase>;
}

/**
 * DLQ admin routes: PLATFORM_ADMIN-only inspector and replay surface.
 *
 * Auth gates:
 *  - `requireAuthContext` (every route) → 401 when no resolved session
 *  - `requirePlatformAdmin` (every use case) → 403 for non-PLATFORM_ADMIN actors
 *
 * Express 5 forwards rejected handler promises to `errorHandler` automatically.
 */
export function dlqAdminRouter(deps: DlqAdminRouterDeps): Router {
  const router = Router();

  router.get('/dlq-events', async (req, res) => {
    const auth = requireAuthContext(req);
    const { limit, cursor } = parsePaginationParams(req.query as Record<string, unknown>);
    const organizationId =
      typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined;

    const page = await deps.listDlqEvents({ auth, limit, cursor, organizationId });

    res.status(200).json({
      items: page.items.map(toDlqListItem),
      nextCursor: page.nextCursor,
    });
  });

  router.get('/dlq-events/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const event = await deps.getDlqEvent({ auth, dlqEventId: req.params.id! });
    res.status(200).json(toDlqInspectDto(event));
  });

  router.post('/dlq-events/:id/requeue', async (req, res) => {
    const auth = requireAuthContext(req);
    const result = await deps.requeueDlqEvent({ auth, dlqEventId: req.params.id! });
    res.status(200).json({ newOutboxId: result.newOutboxId });
  });

  return router;
}

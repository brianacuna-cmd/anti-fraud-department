import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createRunScheduledJobUseCase } from '../../../../application/RunScheduledJob.js';

export interface ScheduledJobAdminRouterDeps {
  readonly runScheduledJob: ReturnType<typeof createRunScheduledJobUseCase>;
}

/**
 * Scheduled-job admin routes: PLATFORM_ADMIN-only force-run surface.
 *
 * Auth gates:
 *  - `requireAuthContext` (every route) → 401 when no resolved session
 *  - `requirePlatformAdmin` (use case) → 403 for non-PLATFORM_ADMIN actors
 *
 * Express 5 forwards rejected handler promises to `errorHandler` automatically.
 */
export function scheduledJobAdminRouter(deps: ScheduledJobAdminRouterDeps): Router {
  const router = Router();

  router.post('/admin/jobs/:jobName/run', async (req, res) => {
    const auth = requireAuthContext(req);
    const result = await deps.runScheduledJob({ auth, jobName: req.params.jobName! });
    res.status(200).json({ jobName: result.jobName, lastResult: result.lastResult });
  });

  return router;
}

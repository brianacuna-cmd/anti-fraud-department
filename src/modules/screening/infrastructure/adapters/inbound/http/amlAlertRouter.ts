import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createListAmlAlertsUseCase } from '../../../../application/ListAmlAlerts.js';
import type { createGetAmlAlertUseCase } from '../../../../application/GetAmlAlert.js';
import type { createGetAmlAlertTimelineUseCase } from '../../../../application/GetAmlAlertTimeline.js';
import type { createTransitionAmlAlertUseCase } from '../../../../application/TransitionAmlAlert.js';
import type { createEscalateAmlAlertUseCase } from '../../../../application/EscalateAmlAlert.js';
import type { createResolveAmlAlertUseCase } from '../../../../application/ResolveAmlAlert.js';
import { listAmlAlertsQuerySchema, resolveAmlAlertSchema } from './dto/amlAlertSchemas.js';
import { toAmlAlertResponse, toAmlAlertTimelineEventResponse } from './mappers/AmlAlertHttpMapper.js';
import { parseRequest } from './parseRequest.js';
import { fromDate } from '../../../../../../shared/time/Instant.js';

export interface AmlAlertRouterDeps {
  readonly listAmlAlerts: ReturnType<typeof createListAmlAlertsUseCase>;
  readonly getAmlAlert: ReturnType<typeof createGetAmlAlertUseCase>;
  readonly getAmlAlertTimeline: ReturnType<typeof createGetAmlAlertTimelineUseCase>;
  readonly transitionAmlAlert: ReturnType<typeof createTransitionAmlAlertUseCase>;
  readonly escalateAmlAlert: ReturnType<typeof createEscalateAmlAlertUseCase>;
  readonly resolveAmlAlert: ReturnType<typeof createResolveAmlAlertUseCase>;
}

/**
 * `/aml-alerts` routes: compliance inbox + triage. Escalate is the only
 * bridge into the fraud Case pipeline. Express 5 forwards a rejected
 * handler promise to `errorHandler` automatically (mirrors `caseRouter`).
 */
export function amlAlertRouter(deps: AmlAlertRouterDeps): Router {
  const router = Router();

  router.get('/aml-alerts', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(listAmlAlertsQuerySchema, req.query);
    const page = await deps.listAmlAlerts({
      auth,
      status: query.status,
      severity: query.severity,
      watchlistId: query.watchlist_id,
      createdAfter: query.from !== undefined ? fromDate(new Date(query.from)) : undefined,
      createdBefore: query.to !== undefined ? fromDate(new Date(query.to)) : undefined,
      limit: query.limit,
      offset: query.offset,
    });
    res.status(200).json({
      items: page.items.map(toAmlAlertResponse),
      total: page.total,
    });
  });

  router.get('/aml-alerts/:alertId', async (req, res) => {
    const auth = requireAuthContext(req);
    const alert = await deps.getAmlAlert({ auth, alertId: req.params.alertId! });
    res.status(200).json(toAmlAlertResponse(alert));
  });

  router.get('/aml-alerts/:alertId/timeline', async (req, res) => {
    const auth = requireAuthContext(req);
    const events = await deps.getAmlAlertTimeline({ auth, alertId: req.params.alertId! });
    res.status(200).json({ items: events.map(toAmlAlertTimelineEventResponse) });
  });

  router.post('/aml-alerts/:alertId/investigate', async (req, res) => {
    const auth = requireAuthContext(req);
    const alert = await deps.transitionAmlAlert({
      auth,
      alertId: req.params.alertId!,
      next: 'INVESTIGATING',
    });
    res.status(200).json(toAmlAlertResponse(alert));
  });

  router.patch('/aml-alerts/:alertId/resolve', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(resolveAmlAlertSchema, req.body);
    const alert = await deps.resolveAmlAlert({
      auth,
      alertId: req.params.alertId!,
      verdict: body.verdict,
      justification: body.justification,
    });
    res.status(200).json(toAmlAlertResponse(alert));
  });

  router.post('/aml-alerts/:alertId/escalate', async (req, res) => {
    const auth = requireAuthContext(req);
    const result = await deps.escalateAmlAlert({ auth, alertId: req.params.alertId! });
    res.status(200).json({
      ...toAmlAlertResponse(result.alert),
      alreadyEscalated: result.alreadyEscalated,
    });
  });

  return router;
}

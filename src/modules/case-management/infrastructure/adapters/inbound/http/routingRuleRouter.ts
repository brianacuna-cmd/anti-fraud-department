import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateRoutingRuleUseCase } from '../../../../application/CreateRoutingRule.js';
import type { createListRoutingRulesUseCase } from '../../../../application/ListRoutingRules.js';
import type { createGetRoutingRuleUseCase } from '../../../../application/GetRoutingRule.js';
import type { createActivateRoutingRuleUseCase } from '../../../../application/ActivateRoutingRule.js';
import type { createDeactivateRoutingRuleUseCase } from '../../../../application/DeactivateRoutingRule.js';
import { createRoutingRuleSchema } from './dto/routingRuleSchemas.js';
import { toRoutingRuleResponse } from './mappers/RoutingRuleHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface RoutingRuleRouterDeps {
  readonly createRoutingRule: ReturnType<typeof createCreateRoutingRuleUseCase>;
  readonly listRoutingRules: ReturnType<typeof createListRoutingRulesUseCase>;
  readonly getRoutingRule: ReturnType<typeof createGetRoutingRuleUseCase>;
  readonly activateRoutingRule: ReturnType<typeof createActivateRoutingRuleUseCase>;
  readonly deactivateRoutingRule: ReturnType<typeof createDeactivateRoutingRuleUseCase>;
}

/**
 * `/case-routing-rules` routes — draft create, list, get, activate, deactivate.
 * Express 5 forwards rejected handler promises to `errorHandler`.
 */
export function routingRuleRouter(deps: RoutingRuleRouterDeps): Router {
  const router = Router();

  router.post('/case-routing-rules', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createRoutingRuleSchema, req.body);
    const rule = await deps.createRoutingRule({
      auth,
      name: body.name,
      conditions: body.conditions,
      conditionsVersion: body.conditionsVersion,
      targetRoleId: body.targetRoleId,
      targetUserId: body.targetUserId,
    });
    res.status(201).json(toRoutingRuleResponse(rule));
  });

  router.get('/case-routing-rules', async (req, res) => {
    const auth = requireAuthContext(req);
    const rules = await deps.listRoutingRules({ auth });
    res.status(200).json({ items: rules.map(toRoutingRuleResponse) });
  });

  router.get('/case-routing-rules/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const rule = await deps.getRoutingRule({ auth, ruleId: req.params.id! });
    res.status(200).json(toRoutingRuleResponse(rule));
  });

  router.post('/case-routing-rules/:id/activate', async (req, res) => {
    const auth = requireAuthContext(req);
    const rule = await deps.activateRoutingRule({ auth, ruleId: req.params.id! });
    res.status(200).json(toRoutingRuleResponse(rule));
  });

  router.post('/case-routing-rules/:id/deactivate', async (req, res) => {
    const auth = requireAuthContext(req);
    const rule = await deps.deactivateRoutingRule({ auth, ruleId: req.params.id! });
    res.status(200).json(toRoutingRuleResponse(rule));
  });

  return router;
}

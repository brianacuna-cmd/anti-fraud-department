import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateRoutingRuleUseCase } from '../../../../application/CreateRoutingRule.js';
import type { createCreatePriorityAssignmentRuleUseCase } from '../../../../application/CreatePriorityAssignmentRule.js';
import type { createListRoutingRulesUseCase } from '../../../../application/ListRoutingRules.js';
import type { createGetRoutingRuleUseCase } from '../../../../application/GetRoutingRule.js';
import type { createActivateRoutingRuleUseCase } from '../../../../application/ActivateRoutingRule.js';
import type { createDeactivateRoutingRuleUseCase } from '../../../../application/DeactivateRoutingRule.js';
import type { createUpdateRoutingRuleUseCase } from '../../../../application/UpdateRoutingRule.js';
import type { createReorderRoutingRulesUseCase } from '../../../../application/ReorderRoutingRules.js';
import {
  simulateRoutingRuleSchema,
  createRoutingRuleSchema,
  createPriorityAssignmentRuleSchema,
  updateRoutingRuleSchema,
  reorderRoutingRulesSchema,
} from './dto/routingRuleSchemas.js';
import { toRoutingRuleResponse, toUpdateRoutingRuleFields } from './mappers/RoutingRuleHttpMapper.js';
import type { createSimulateRoutingRuleUseCase } from '../../../../application/SimulateRoutingRule.js';
import { parseRequest } from './parseRequest.js';

export interface RoutingRuleRouterDeps {
  readonly createRoutingRule: ReturnType<typeof createCreateRoutingRuleUseCase>;
  readonly createPriorityAssignmentRule: ReturnType<typeof createCreatePriorityAssignmentRuleUseCase>;
  readonly listRoutingRules: ReturnType<typeof createListRoutingRulesUseCase>;
  readonly getRoutingRule: ReturnType<typeof createGetRoutingRuleUseCase>;
  readonly updateRoutingRule: ReturnType<typeof createUpdateRoutingRuleUseCase>;
  readonly reorderRoutingRules: ReturnType<typeof createReorderRoutingRulesUseCase>;
  readonly activateRoutingRule: ReturnType<typeof createActivateRoutingRuleUseCase>;
  readonly deactivateRoutingRule: ReturnType<typeof createDeactivateRoutingRuleUseCase>;
  readonly simulateRoutingRule: ReturnType<typeof createSimulateRoutingRuleUseCase>;
}

/**
 * `/case-routing-rules` routes — draft create, list, get, patch, reorder, activate, deactivate.
 * Express 5 forwards rejected handler promises to `errorHandler`. Status changes
 * only via activate/deactivate, never PATCH. PUT `/reorder` is a static path
 * declared beside `/simulate`, before `/:id`.
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

  router.post('/case-routing-rules/priority-mapping', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createPriorityAssignmentRuleSchema, req.body);
    const rule = await deps.createPriorityAssignmentRule({
      auth,
      name: body.name,
      mappings: body.mappings,
    });
    res.status(201).json(toRoutingRuleResponse(rule));
  });

  /*
   * Dry run from the decision editor. Returns 200 even when the graph fails:
   * that it does not compile is the answer the caller came for, not a server
   * error. Declared before `/:id` out of defensive habit — the day someone
   * adds `POST /case-routing-rules/:id`, "simulate" would stop being a route.
   */
  router.post('/case-routing-rules/simulate', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(simulateRoutingRuleSchema, req.body);
    const outcome = await deps.simulateRoutingRule({
      auth,
      conditions: body.conditions,
      context: body.case,
    });
    res.status(200).json(outcome);
  });

  /*
   * Catalog permutation. Static path beside `/simulate`, before `/:id`, so
   * "reorder" is never captured as a rule id.
   */
  router.put('/case-routing-rules/reorder', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(reorderRoutingRulesSchema, req.body);
    const rules = await deps.reorderRoutingRules({ auth, ids: body.ids });
    res.status(200).json({ items: rules.map(toRoutingRuleResponse) });
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

  router.patch('/case-routing-rules/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(updateRoutingRuleSchema, req.body);
    const rule = await deps.updateRoutingRule({
      auth,
      ruleId: req.params.id!,
      ...toUpdateRoutingRuleFields(body),
    });
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

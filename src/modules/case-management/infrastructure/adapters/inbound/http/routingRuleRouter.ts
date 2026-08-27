import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateRoutingRuleUseCase } from '../../../../application/CreateRoutingRule.js';
import type { createListRoutingRulesUseCase } from '../../../../application/ListRoutingRules.js';
import type { createGetRoutingRuleUseCase } from '../../../../application/GetRoutingRule.js';
import type { createActivateRoutingRuleUseCase } from '../../../../application/ActivateRoutingRule.js';
import type { createDeactivateRoutingRuleUseCase } from '../../../../application/DeactivateRoutingRule.js';
import {
  createPriorityMappingRuleSchema,
  createRoutingRuleSchema,
  simulateRoutingRuleSchema,
} from './dto/routingRuleSchemas.js';
import type { createSimulateRoutingRuleUseCase } from '../../../../application/SimulateRoutingRule.js';
import { buildPriorityRoutingJdm } from '../../../../domain/services/priorityRoutingJdm.js';
import { toRoutingRuleResponse } from './mappers/RoutingRuleHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface RoutingRuleRouterDeps {
  readonly createRoutingRule: ReturnType<typeof createCreateRoutingRuleUseCase>;
  readonly listRoutingRules: ReturnType<typeof createListRoutingRulesUseCase>;
  readonly getRoutingRule: ReturnType<typeof createGetRoutingRuleUseCase>;
  readonly activateRoutingRule: ReturnType<typeof createActivateRoutingRuleUseCase>;
  readonly deactivateRoutingRule: ReturnType<typeof createDeactivateRoutingRuleUseCase>;
  readonly simulateRoutingRule: ReturnType<typeof createSimulateRoutingRuleUseCase>;
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

  /*
   * Atajo del panel: reparto por prioridad. Reutiliza `createRoutingRule`
   * —una sola vía de creación, un solo rastro de auditoría— y lo único que
   * añade es traducir el mapeo a un grafo JDM. La ruta se declara antes que
   * `/:id` por costumbre defensiva: hoy no colisionan (esta tiene dos
   * segmentos y la de activar tres), pero el día que alguien añada
   * `POST /case-routing-rules/:id`, «priority-mapping» dejaría de ser una
   * ruta y pasaría a ser un id.
   */
  router.post('/case-routing-rules/priority-mapping', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createPriorityMappingRuleSchema, req.body);
    const rule = await deps.createRoutingRule({
      auth,
      name: body.name,
      conditions: buildPriorityRoutingJdm(
        body.mappings.map((m) => ({
          priority: m.priority,
          targetType: m.target.type,
          targetId: m.target.id,
        })),
      ),
      conditionsVersion: 1,
      targetRoleId: null,
      targetUserId: null,
    });
    res.status(201).json(toRoutingRuleResponse(rule));
  });

  /*
   * Ensayo en seco desde el editor de decisiones. Devuelve 200 aunque el
   * grafo falle: que no compile es el resultado que se ha venido a buscar.
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

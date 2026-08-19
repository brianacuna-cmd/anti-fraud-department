import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRoutingRuleRepository } from '../domain/ports/CaseRoutingRuleRepository.js';
import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseRoutingRuleId } from '../domain/model/value-objects/CaseRoutingRuleId.js';
import { CaseRoutingRule, type RoutingConditions } from '../domain/model/aggregates/CaseRoutingRule.js';
import { createCaseRoutingRuleId } from '../domain/model/value-objects/CaseRoutingRuleId.js';
import { createAssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import { assigneeNotFound, invariantViolation } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

/**
 * CASE-002 no pide endpoints de gestion, solo el evaluador. Pero sin una via
 * para escribir reglas la funcion nace muerta: no habria forma de crear
 * ninguna salvo insertando documentos a mano en Mongo. Esto es el minimo para
 * que el evaluador tenga algo que evaluar.
 */

export interface UpsertCaseRoutingRuleInput {
  readonly auth: AuthContext;
  /** Omitido para crear; presente para reemplazar una regla existente. */
  readonly ruleId?: string;
  readonly name: string;
  readonly evaluationOrder: number;
  readonly conditions: RoutingConditions;
  readonly assignTo: { readonly type: string; readonly id: string };
  readonly status?: 'ACTIVE' | 'INACTIVE';
}

export interface ManageCaseRoutingRulesDeps {
  readonly routingRules: CaseRoutingRuleRepository;
  readonly assigneeDirectory: AssigneeDirectory;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
  readonly generateCaseRoutingRuleId: () => CaseRoutingRuleId;
}

export function createUpsertCaseRoutingRuleUseCase(deps: ManageCaseRoutingRulesDeps) {
  return async function upsertCaseRoutingRule(input: UpsertCaseRoutingRuleInput): Promise<CaseRoutingRule> {
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();

    const assignTo = createAssignedTo(input.assignTo.type, input.assignTo.id);

    // El destinatario se valida al ESCRIBIR la regla, no solo al aplicarla.
    // Descubrir que apunta a alguien inexistente en el momento de enrutar
    // significa que el caso ya se abrio sin asignar y nadie se entera.
    const exists =
      assignTo.type === 'USER'
        ? await deps.assigneeDirectory.userExists(organizationId, assignTo.id)
        : await deps.assigneeDirectory.roleExists(assignTo.id);
    if (!exists) {
      throw assigneeNotFound(assignTo.type, assignTo.id);
    }

    let ruleId: CaseRoutingRuleId;
    let createdAt = now;

    if (input.ruleId) {
      const existing = await deps.routingRules.findById(createCaseRoutingRuleId(input.ruleId));
      if (!existing || existing.organizationId !== organizationId) {
        throw invariantViolation('La regla de enrutamiento no existe', { ruleId: input.ruleId });
      }
      ruleId = existing.id;
      createdAt = existing.createdAt;
    } else {
      ruleId = deps.generateCaseRoutingRuleId();
    }

    const rule = CaseRoutingRule.rehydrate({
      ...CaseRoutingRule.create({
        id: ruleId,
        organizationId,
        name: input.name,
        evaluationOrder: input.evaluationOrder,
        conditions: input.conditions,
        assignTo,
        status: input.status,
        now,
      }).toProps(),
      createdAt,
    });

    await deps.routingRules.save(rule);

    await deps.auditRecorder.record({
      organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId ?? organizationId,
      action: 'ROUTE_CASE',
      resource: 'rule',
      resourceId: rule.id,
      detail: {
        operation: input.ruleId ? 'UPDATE' : 'CREATE',
        name: rule.name,
        evaluationOrder: rule.evaluationOrder,
        assignTo: `${rule.assignTo.type}:${rule.assignTo.id}`,
        status: rule.status,
        conditions: rule.conditions as Record<string, unknown>,
      },
      ipAddress: input.auth.ipAddress,
    });

    return rule;
  };
}

export interface ListCaseRoutingRulesInput {
  readonly auth: AuthContext;
}

export function createListCaseRoutingRulesUseCase(deps: Pick<ManageCaseRoutingRulesDeps, 'routingRules'>) {
  return async function listCaseRoutingRules(
    input: ListCaseRoutingRulesInput,
  ): Promise<readonly CaseRoutingRule[]> {
    // `listAll`, no `listActive`: quien configura necesita ver tambien las
    // reglas apagadas para poder reactivarlas.
    return deps.routingRules.listAll(requireTenantContext(input.auth));
  };
}

export interface SetCaseRoutingRuleStatusInput {
  readonly auth: AuthContext;
  readonly ruleId: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
}

export function createSetCaseRoutingRuleStatusUseCase(deps: ManageCaseRoutingRulesDeps) {
  return async function setCaseRoutingRuleStatus(
    input: SetCaseRoutingRuleStatusInput,
  ): Promise<CaseRoutingRule> {
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();

    const existing = await deps.routingRules.findById(createCaseRoutingRuleId(input.ruleId));
    if (!existing || existing.organizationId !== organizationId) {
      throw invariantViolation('La regla de enrutamiento no existe', { ruleId: input.ruleId });
    }

    const updated = input.status === 'ACTIVE' ? existing.activate(now) : existing.deactivate(now);
    await deps.routingRules.save(updated);

    await deps.auditRecorder.record({
      organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId ?? organizationId,
      action: 'ROUTE_CASE',
      resource: 'rule',
      resourceId: updated.id,
      detail: { operation: 'SET_STATUS', previousStatus: existing.status, status: updated.status },
      ipAddress: input.auth.ipAddress,
    });

    return updated;
  };
}

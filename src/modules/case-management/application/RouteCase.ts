import type { ActorType } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRoutingRule } from '../domain/model/aggregates/CaseRoutingRule.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { CaseRoutingRuleRepository } from '../domain/ports/CaseRoutingRuleRepository.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { RoutingEngine, RoutingEvaluation } from '../domain/ports/RoutingEngine.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import type { AssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import { createAssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';

export interface RouteCaseInput {
  readonly kase: Case;
  readonly tx: Transaction;
  /**
   * Timeline attribution. `null` for system-triggered auto-routing (T1 on case
   * creation) — no human chose the assignee, the rule did.
   */
  readonly createdBy: string | null;
  /** Audit attribution for the request this routing ran under. */
  readonly actorType: ActorType;
  readonly ipAddress: string | null;
}

export interface RouteCaseDeps {
  readonly cases: CaseRepository;
  readonly routingRules: CaseRoutingRuleRepository;
  readonly routingEngine: RoutingEngine;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly fraudConfig: OrganizationFraudConfigRepository;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * T1 — auto-routing on case creation. Loads ACTIVE `CaseRoutingRules` for the
 * case's organization, evaluates each JDM via ZEN Engine against the case
 * context (`riskScore`, `status`, `priority`, `tags`), and on the first match
 * assigns `AssignedTo` / `AssignedToType` and appends an `ASSIGNED` timeline
 * event. Rules are tried in ascending `CreatedAt` order (first-match wins).
 *
 * Opt-out: `OrganizationFraudConfig.featureFlags.autoRouting === false` skips
 * routing entirely. A missing config or an absent flag leaves routing ON —
 * every tenant without an explicit opt-out keeps the default behavior.
 *
 * Rule isolation: a rule whose JDM fails to compile or evaluate is SKIPPED
 * (audited as `ROUTING_RULE_EVALUATION_FAILED`) instead of propagating, which
 * would roll back the enclosing `CreateCase` transaction and make a single
 * malformed rule block all case creation for that organization.
 *
 * Provenance: the winning rule's id, name and `conditionsVersion` land in the
 * `REASSIGN_CASE` audit row's detail, so an assignment can always be traced
 * back to the exact rule version that produced it.
 */
export function createRouteCaseUseCase(deps: RouteCaseDeps) {
  return async function routeCase(input: RouteCaseInput): Promise<Case> {
    const organizationId = input.kase.organizationId;
    if (!(await isAutoRoutingEnabled(deps, organizationId, input.tx))) {
      return input.kase;
    }

    const rules = await deps.routingRules.findActiveByOrganization(organizationId, input.tx);
    if (rules.length === 0) {
      return input.kase;
    }

    const context = {
      riskScore: input.kase.riskScore,
      status: input.kase.status,
      priority: input.kase.priority,
      tags: input.kase.tags,
    };

    for (const rule of rules) {
      const outcome = await evaluateRule(deps, rule, context, input);
      if (!outcome.ok) {
        continue;
      }
      const assignedTo = resolveAssignment(outcome.evaluation, rule);
      if (assignedTo === null) {
        continue;
      }

      const now = deps.clock.now();
      const updated = input.kase.reassign(assignedTo, now);
      await deps.cases.save(updated, input.tx);

      const timelineEvent = CaseTimelineEvent.create({
        id: deps.generateTimelineEventId(),
        caseId: updated.id,
        eventType: 'ASSIGNED',
        previousValue: null,
        newValue: assignedTo.id,
        createdBy: input.createdBy,
        createdAt: now,
      });
      await deps.timelineRecorder.record(timelineEvent, input.tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.actorType,
          actorId: input.createdBy,
          action: 'REASSIGN_CASE',
          resource: 'case',
          resourceId: updated.id,
          detail: {
            trigger: 'AUTO_ROUTING',
            ruleId: rule.id,
            ruleName: rule.name,
            conditionsVersion: rule.conditionsVersion,
            assignedToId: assignedTo.id,
            assignedToType: assignedTo.type,
          },
          ipAddress: input.ipAddress,
        },
        input.tx,
      );

      return updated;
    }

    return input.kase;
  };
}

/** Routing is ON unless the tenant explicitly set `featureFlags.autoRouting` to `false`. */
async function isAutoRoutingEnabled(
  deps: RouteCaseDeps,
  organizationId: string,
  tx: Transaction,
): Promise<boolean> {
  const config = await deps.fraudConfig.findByOrganization(organizationId, tx);
  return config?.featureFlags.autoRouting !== false;
}

/**
 * Outcome of evaluating one rule. `ok: false` (engine threw) is deliberately
 * NOT collapsed into a null `evaluation`: the two mean different things to
 * `resolveAssignment`, which falls back to the rule-level target when the JDM
 * merely omitted both outputs. An unusable rule must be skipped whole,
 * fallback included.
 */
type RuleOutcome = { readonly ok: true; readonly evaluation: RoutingEvaluation | null } | { readonly ok: false };

/**
 * Evaluates one rule, converting any engine failure (malformed JDM, bad
 * expression, engine panic) into a skip plus an audit row.
 */
async function evaluateRule(
  deps: RouteCaseDeps,
  rule: CaseRoutingRule,
  context: Parameters<RoutingEngine['evaluate']>[1],
  input: RouteCaseInput,
): Promise<RuleOutcome> {
  try {
    return { ok: true, evaluation: await deps.routingEngine.evaluate(rule.conditions, context) };
  } catch (error) {
    await deps.auditRecorder.record(
      {
        organizationId: rule.organizationId,
        actorType: input.actorType,
        actorId: input.createdBy,
        action: 'ROUTING_RULE_EVALUATION_FAILED',
        resource: 'rule',
        resourceId: rule.id,
        detail: {
          caseId: input.kase.id,
          ruleName: rule.name,
          conditionsVersion: rule.conditionsVersion,
          reason: error instanceof Error ? error.message : String(error),
        },
        ipAddress: input.ipAddress,
      },
      input.tx,
    );
    return { ok: false };
  }
}

function resolveAssignment(
  evaluation: RoutingEvaluation | null,
  rule: CaseRoutingRule,
): AssignedTo | null {
  const targetUserId = evaluation?.targetUserId ?? rule.targetUserId;
  const targetRoleId = evaluation?.targetRoleId ?? rule.targetRoleId;

  if (isNonEmptyString(targetUserId)) {
    return createAssignedTo('USER', targetUserId);
  }
  if (isNonEmptyString(targetRoleId)) {
    return createAssignedTo('ROLE', targetRoleId);
  }
  return null;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

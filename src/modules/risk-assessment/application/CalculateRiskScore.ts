import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CanonicalRiskEvent } from '../domain/model/CanonicalRiskEvent.js';
import type { RiskScoringRule } from '../domain/model/aggregates/RiskScoringRule.js';
import type { RiskScore } from '../domain/model/value-objects/RiskScore.js';
import { createRiskScore } from '../domain/model/value-objects/RiskScore.js';
import type { RiskScoringRuleId } from '../domain/model/value-objects/RiskScoringRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { RiskScoringEngine } from '../domain/ports/RiskScoringEngine.js';
import type { RiskScoringRuleRepository } from '../domain/ports/RiskScoringRuleRepository.js';
import { invariantViolation, scoringRuleNotFound } from '../domain/errors/RiskAssessmentError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface CalculateRiskScoreInput {
  readonly auth: AuthContext;
  readonly event: CanonicalRiskEvent;
}

export interface CalculateRiskScoreResult {
  readonly riskScore: RiskScore;
  readonly ruleId: RiskScoringRuleId;
  readonly name: string;
  readonly conditionsVersion: number;
}

export interface CalculateRiskScoreDeps {
  readonly scoringRules: RiskScoringRuleRepository;
  readonly scoringEngine: RiskScoringEngine;
  readonly auditRecorder: AuditRecorder;
}

/** JDM context — omit `rawPayload` only. */
function toScoringContext(event: CanonicalRiskEvent): Readonly<Record<string, unknown>> {
  const context: Record<string, unknown> = { ...event };
  delete context.rawPayload;
  return context;
}

/**
 * Standalone scoring orchestrator. Loads ACTIVE rules (oldest first),
 * evaluates only `rules[0]`, fails closed, and never creates a Case.
 * Does not wrap work in `withTransaction` (read + audit only).
 */
export function createCalculateRiskScoreUseCase(deps: CalculateRiskScoreDeps) {
  return async function calculateRiskScore(input: CalculateRiskScoreInput): Promise<CalculateRiskScoreResult> {
    const organizationId = requireTenantContext(input.auth);
    const rules = await deps.scoringRules.findActiveByOrganization(organizationId);
    const rule = rules[0];
    if (rule === undefined) {
      throw scoringRuleNotFound(organizationId);
    }

    const riskScore = await evaluateFirstRule(deps, rule, input);

    await deps.auditRecorder.record({
      organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId,
      action: 'CALCULATE_RISK_SCORE',
      resource: 'rule',
      resourceId: rule.id,
      detail: {
        ruleName: rule.name,
        conditionsVersion: rule.conditionsVersion,
        riskScore,
      },
      ipAddress: input.auth.ipAddress,
    });

    return {
      riskScore,
      ruleId: rule.id,
      name: rule.name,
      conditionsVersion: rule.conditionsVersion,
    };
  };
}

async function evaluateFirstRule(
  deps: CalculateRiskScoreDeps,
  rule: RiskScoringRule,
  input: CalculateRiskScoreInput,
): Promise<RiskScore> {
  let rawScore: number;
  try {
    const evaluation = await deps.scoringEngine.evaluate(rule.conditions, toScoringContext(input.event));
    rawScore = evaluation.riskScore;
  } catch (error) {
    await deps.auditRecorder.record({
      organizationId: rule.organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId,
      action: 'SCORING_RULE_EVALUATION_FAILED',
      resource: 'rule',
      resourceId: rule.id,
      detail: {
        ruleName: rule.name,
        conditionsVersion: rule.conditionsVersion,
        reason: error instanceof Error ? error.message : String(error),
      },
      ipAddress: input.auth.ipAddress,
    });
    throw invariantViolation('scoring rule evaluation failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  return createRiskScore(rawScore);
}

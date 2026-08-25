import type { AuthContext } from '../shared/kernel/AuthContext.js';
import type { CanonicalRiskEvent } from '../modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import type { createCalculateRiskScoreUseCase } from '../modules/risk-assessment/application/CalculateRiskScore.js';
import type { createGetOrganizationFraudConfigUseCase } from '../modules/case-management/application/GetOrganizationFraudConfig.js';
import type {
  CreateCaseInput,
  createCreateCaseUseCase,
} from '../modules/case-management/application/CreateCase.js';
import type { CasePriority } from '../modules/case-management/domain/model/value-objects/CasePriority.js';

export interface ScoreToCaseOrchestratorInput {
  readonly auth: AuthContext;
  readonly event: CanonicalRiskEvent;
}

export interface ScoreToCaseOrchestratorResult {
  readonly riskScore: number;
  readonly ruleId: string;
  readonly conditionsVersion: number;
  readonly opened: boolean;
  readonly caseId?: string;
  readonly priority?: CasePriority;
}

export interface ScoreToCaseOrchestratorDeps {
  readonly calculateRiskScore: ReturnType<typeof createCalculateRiskScoreUseCase>;
  readonly getOrganizationFraudConfig: ReturnType<typeof createGetOrganizationFraudConfigUseCase>;
  readonly createCase: ReturnType<typeof createCreateCaseUseCase>;
}

/**
 * Composition-root orchestrator (eslint boundaries): score → org thresholds →
 * optional CreateCase con la evidencia del scoring. Lives outside module
 * trees so risk-assessment never imports case-management application code.
 */
export function createScoreToCaseOrchestrator(deps: ScoreToCaseOrchestratorDeps) {
  return async function processRiskScoreToCase(
    input: ScoreToCaseOrchestratorInput,
  ): Promise<ScoreToCaseOrchestratorResult> {
    const scoreResult = await deps.calculateRiskScore({
      auth: input.auth,
      event: input.event,
    });

    const fraudConfig = await deps.getOrganizationFraudConfig({ auth: input.auth });
    const priority = fraudConfig.priorityForRiskScore(scoreResult.riskScore);

    if (priority === null) {
      return {
        riskScore: scoreResult.riskScore,
        ruleId: scoreResult.ruleId,
        conditionsVersion: scoreResult.conditionsVersion,
        opened: false,
      };
    }

    const createInput: CreateCaseInput = {
      auth: input.auth,
      customerId: input.event.caseCustomerId,
      riskScore: scoreResult.riskScore,
      priority,
      scoringEvidence: buildScoringEvidence(input.event, scoreResult),
    };
    const kase = await deps.createCase(createInput);

    return {
      riskScore: scoreResult.riskScore,
      ruleId: scoreResult.ruleId,
      conditionsVersion: scoreResult.conditionsVersion,
      opened: true,
      caseId: kase.id,
      priority,
    };
  };
}

/**
 * Se llamaba `buildFinturuCacheSnapshot` y no construía nada de Finturu: son
 * el evento que abrió el caso y el veredicto del motor. El nombre venía del
 * campo donde acababa, que ya no existe.
 */
function buildScoringEvidence(
  event: CanonicalRiskEvent,
  scoreResult: {
    readonly riskScore: number;
    readonly ruleId: string;
    readonly conditionsVersion: number;
    readonly hits: readonly unknown[];
  },
): Record<string, unknown> {
  const eventSansRaw: Record<string, unknown> = { ...event };
  delete eventSansRaw.rawPayload;
  delete eventSansRaw.subjectIdentity;
  return {
    event: eventSansRaw,
    ruleId: scoreResult.ruleId,
    conditionsVersion: scoreResult.conditionsVersion,
    riskScore: scoreResult.riskScore,
    hits: [...scoreResult.hits],
  };
}

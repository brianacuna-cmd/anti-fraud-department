import { fromDate } from '../../../../../../../shared/time/Instant.js';
import type { CanonicalRiskEvent } from '../../../../../domain/model/CanonicalRiskEvent.js';
import { createCanonicalRiskEvent } from '../../../../../domain/model/CanonicalRiskEvent.js';
import type { CalculateRiskScoreResult } from '../../../../../application/CalculateRiskScore.js';
import type { CalculateRiskScoreBody } from '../dto/riskScoreSchemas.js';

export interface RiskScoreResponseDto {
  readonly riskScore: number;
  readonly ruleId: string;
  readonly name: string;
  readonly conditionsVersion: number;
  /** Engine collect evidence passthrough — not validated as ScoringHit. */
  readonly hits: readonly unknown[];
}

/** HTTP → domain. `rawPayload` may be present on the event; the use case strips it from engine context. */
export function toCanonicalRiskEvent(body: CalculateRiskScoreBody): CanonicalRiskEvent {
  return createCanonicalRiskEvent({
    ...body,
    createdAt: fromDate(new Date(body.createdAt)),
  });
}

/** Scoring response — never echoes `rawPayload`. */
export function toRiskScoreResponse(result: CalculateRiskScoreResult): RiskScoreResponseDto {
  return {
    riskScore: result.riskScore,
    ruleId: result.ruleId,
    name: result.name,
    conditionsVersion: result.conditionsVersion,
    hits: result.hits,
  };
}

import type { AuthContext } from '../shared/kernel/AuthContext.js';
import type { CanonicalRiskEvent } from '../modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import { createCanonicalRiskEvent } from '../modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import type {
  ScreenSubjectAgainstWatchlistInput,
  createScreenSubjectAgainstWatchlistUseCase,
} from '../modules/screening/application/ScreenSubjectAgainstWatchlist.js';
import type {
  ScoreToCaseOrchestratorInput,
  ScoreToCaseOrchestratorResult,
} from './scoreToCaseOrchestrator.js';

export interface ScreenThenScoreToCaseOrchestratorInput {
  readonly auth: AuthContext;
  readonly event: CanonicalRiskEvent;
  /** Subject fields to screen against the watchlist (RF-2/RF-4). */
  readonly screening: Omit<ScreenSubjectAgainstWatchlistInput, 'auth'>;
}

export interface ScreenThenScoreToCaseOrchestratorDeps {
  readonly screenSubject: ReturnType<typeof createScreenSubjectAgainstWatchlistUseCase>;
  readonly scoreToCaseOrchestrator: (
    input: ScoreToCaseOrchestratorInput,
  ) => Promise<ScoreToCaseOrchestratorResult>;
}

/**
 * Composition-root orchestrator (eslint boundaries): screen subject against
 * the watchlist first (RF-2/RF-4, alerts already persisted inside
 * `screenSubject`), then — only when the top match reaches the signal tier
 * (confidence >= 70) — builds a NEW immutable `CanonicalRiskEvent` with
 * `riskSignals` enriched by the four camelCase watchlist keys, and
 * delegates to the EXISTING `scoreToCaseOrchestrator` unchanged (RF-7: this
 * module never blocks/approves on its own). When `riskSignal` is null, the
 * original event instance is forwarded untouched. Lives outside module
 * trees (composition root) so screening and risk-assessment/case-management
 * never import each other directly — zero cross-module import violation.
 */
export function createScreenThenScoreToCaseOrchestrator(deps: ScreenThenScoreToCaseOrchestratorDeps) {
  return async function processScreenThenScore(
    input: ScreenThenScoreToCaseOrchestratorInput,
  ): Promise<ScoreToCaseOrchestratorResult> {
    const screenResult = await deps.screenSubject({
      auth: input.auth,
      ...input.screening,
    });

    const event =
      screenResult.riskSignal === null
        ? input.event
        : createCanonicalRiskEvent({
            ...input.event,
            riskSignals: {
              ...input.event.riskSignals,
              watchlistHit: screenResult.riskSignal.watchlistHit,
              watchlistConfidence: screenResult.riskSignal.watchlistConfidence,
              watchlistSource: screenResult.riskSignal.watchlistSource,
              watchlistRiskLevel: screenResult.riskSignal.watchlistRiskLevel,
            },
          });

    return deps.scoreToCaseOrchestrator({ auth: input.auth, event });
  };
}

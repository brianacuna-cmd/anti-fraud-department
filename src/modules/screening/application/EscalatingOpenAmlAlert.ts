import type { OpenAmlAlertInput, OpenAmlAlertResult } from './OpenAmlAlert.js';
import type { EscalateAmlAlertInput, EscalateAmlAlertResult } from './EscalateAmlAlert.js';
import { DEFAULT_CONFIDENCE_THRESHOLDS, tierConfidence } from '../domain/services/ConfidenceTiering.js';

export interface EscalatingOpenAmlAlertDeps {
  readonly openAmlAlert: (input: OpenAmlAlertInput) => Promise<OpenAmlAlertResult>;
  readonly escalateAmlAlert: (input: EscalateAmlAlertInput) => Promise<EscalateAmlAlertResult>;
  /** An escalation failure must not abort a rescreen run; the alert stays in the inbox. */
  readonly onEscalationError?: (alertId: string, error: unknown) => void;
}

/**
 * Wraps `openAmlAlert` so a STRONG match (confidence at or above the org's
 * signal threshold) goes straight into a fraud case instead of waiting in
 * the AML inbox for someone to click «escalate».
 *
 * A strong match is not a question for triage: the name or wallet matched
 * well enough to raise risk signals, and every such alert ended up escalated
 * anyway. Only the doubtful band (alert threshold up to the signal
 * threshold) still needs a human to say whether it is the same party.
 *
 * Escalation reuses `EscalateAmlAlert`: an alert already linked to the
 * customer's open case (see `CaseLinkingOpenAmlAlert`, which should run
 * inside this wrapper) is left as it is, and a new case is idempotent on the
 * alert id. Duplicates and non-opened results are returned untouched.
 */
export function createEscalatingOpenAmlAlert(deps: EscalatingOpenAmlAlertDeps) {
  return async function openAndEscalateStrongMatch(input: OpenAmlAlertInput): Promise<OpenAmlAlertResult> {
    const result = await deps.openAmlAlert(input);
    if (!result.opened || result.alert === null) return result;
    const thresholds = input.thresholds ?? DEFAULT_CONFIDENCE_THRESHOLDS;
    if (tierConfidence(input.confidence, thresholds) !== 'ALERT_AND_SIGNAL') return result;

    try {
      const escalated = await deps.escalateAmlAlert({ auth: input.auth, alertId: String(result.alert.id) });
      return { ...result, alert: escalated.alert };
    } catch (error) {
      deps.onEscalationError?.(String(result.alert.id), error);
      return result;
    }
  };
}

import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { EntryType } from '../domain/model/value-objects/EntryType.js';
import type { MatchField } from '../domain/model/value-objects/MatchField.js';
import { createMatchField } from '../domain/model/value-objects/MatchField.js';
import type { MatchScore } from '../domain/model/value-objects/MatchScore.js';
import type { ScreeningMatch } from '../domain/model/entities/ScreeningMatch.js';
import { createScreeningMatch } from '../domain/model/entities/ScreeningMatch.js';
import type { OpenAmlAlertInput, OpenAmlAlertResult } from './OpenAmlAlert.js';
import type {
  WatchlistCandidate,
  WatchlistCandidateQuery,
  WatchlistCandidateRepository,
} from '../domain/ports/WatchlistCandidateRepository.js';
import type { PhoneticEncoder } from '../domain/ports/PhoneticEncoder.js';
import type { SimilarityCalculator } from '../domain/ports/SimilarityCalculator.js';
import { normalizeName } from '../domain/ports/NameNormalizer.js';
import { selectStrategy, scoreMatch } from '../domain/services/MatchingStrategySelector.js';
import type { ConfidenceThresholds, ConfidenceTier } from '../domain/services/ConfidenceTiering.js';
import { DEFAULT_CONFIDENCE_THRESHOLDS, tierConfidence } from '../domain/services/ConfidenceTiering.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

const DEFAULT_CANDIDATE_LIMIT = 25;

export interface ScreenSubjectAgainstWatchlistInput {
  readonly auth: AuthContext;
  readonly customerId: string;
  readonly entryType: EntryType;
  readonly nombre?: string;
  readonly documento?: string;
  readonly walletAddress?: string;
  readonly limit?: number;
  /**
   * Request-scoped per-org confidence thresholds override (design D-8).
   * Takes precedence over `ScreenSubjectAgainstWatchlistDeps.thresholds`,
   * which itself falls back to `DEFAULT_CONFIDENCE_THRESHOLDS`. This lets a
   * single bootstrap-built use case be reused across requests carrying
   * different `OrganizationScreeningConfig` values, without rebuilding it
   * per request.
   */
  readonly thresholds?: ConfidenceThresholds;
}

export interface ScreeningMatchResult {
  readonly match: ScreeningMatch;
  readonly confidence: MatchScore;
  readonly tier: ConfidenceTier;
  /**
   * Mutable by design (D-7): starts `null` at scoring time and is set in
   * place by `persistAlerts` to the real persisted `AmlAlertId` for every
   * non-DISCARD match, since `matches` and the internally persisted alerts
   * share the same object references.
   */
  alertId: string | null;
}

/**
 * Camel-case-only watchlist risk signal, ready to be folded into a
 * `CanonicalRiskEvent.riskSignals` by the Slice 7 composition orchestrator
 * (spec RF-4). Only present when the top-scoring match reaches the
 * `ALERT_AND_SIGNAL` tier.
 */
export interface WatchlistRiskSignal {
  readonly watchlistHit: true;
  readonly watchlistConfidence: number;
  readonly watchlistSource: string;
  readonly watchlistRiskLevel: string | null;
}

export interface ScreenSubjectAgainstWatchlistResult {
  /** All scored candidates across every screened field, ranked confidence descending. */
  readonly matches: readonly ScreeningMatchResult[];
  /** Non-null only when the top match qualifies for signal propagation (confidence >= signalThreshold). */
  readonly riskSignal: WatchlistRiskSignal | null;
}

export interface ScreenSubjectAgainstWatchlistDeps {
  readonly watchlistCandidateRepository: WatchlistCandidateRepository;
  readonly openAmlAlert: (input: OpenAmlAlertInput) => Promise<OpenAmlAlertResult>;
  readonly phoneticEncoder: PhoneticEncoder;
  readonly similarityCalculator: SimilarityCalculator;
  /** Org-configurable confidence cutoffs (D-1); defaults to 50/70 when omitted. */
  readonly thresholds?: ConfidenceThresholds;
}

interface SubjectField {
  readonly field: MatchField;
  readonly subjectValue: string;
}

function subjectFields(input: ScreenSubjectAgainstWatchlistInput): SubjectField[] {
  const fields: SubjectField[] = [];
  // Trim the stored subjectValue, not just the emptiness check: DOCUMENTO and
  // WALLET feed exact/Levenshtein matching directly, so a padded input (e.g.
  // " 12345 ") would otherwise never match the stored (unpadded) entry and
  // silently drop the alert/risk signal. NAME is normalized later anyway.
  const nombre = input.nombre?.trim();
  if (nombre !== undefined && nombre.length > 0) {
    fields.push({ field: createMatchField('NAME'), subjectValue: nombre });
  }
  const documento = input.documento?.trim();
  if (documento !== undefined && documento.length > 0) {
    fields.push({ field: createMatchField('DOCUMENTO'), subjectValue: documento });
  }
  const walletAddress = input.walletAddress?.trim();
  if (walletAddress !== undefined && walletAddress.length > 0) {
    fields.push({ field: createMatchField('WALLET'), subjectValue: walletAddress });
  }
  return fields;
}

function buildQuery(
  organizationId: string,
  input: ScreenSubjectAgainstWatchlistInput,
  subjectField: SubjectField,
  phoneticEncoder: PhoneticEncoder,
): WatchlistCandidateQuery {
  const base: WatchlistCandidateQuery = {
    organizationId,
    entryType: input.entryType,
    limit: input.limit ?? DEFAULT_CANDIDATE_LIMIT,
  };

  if (subjectField.field === 'NAME') {
    const normalizedName = normalizeName(subjectField.subjectValue);
    const phoneticKeys = normalizedName
      .split(' ')
      .filter((token) => token.length > 0)
      .flatMap((token) => phoneticEncoder.encode(token));
    return { ...base, normalizedName, phoneticKeys };
  }
  if (subjectField.field === 'DOCUMENTO') {
    return { ...base, documento: subjectField.subjectValue };
  }
  return { ...base, walletAddress: subjectField.subjectValue };
}

function candidateValueForField(candidate: WatchlistCandidate, field: MatchField): string | null {
  if (field === 'NAME') return candidate.nombre;
  if (field === 'DOCUMENTO') return candidate.documento;
  return candidate.walletAddress;
}

function algorithmFor(field: MatchField): string {
  return selectStrategy(field);
}

async function scoreCandidatesForField(
  deps: ScreenSubjectAgainstWatchlistDeps,
  organizationId: string,
  input: ScreenSubjectAgainstWatchlistInput,
  subjectField: SubjectField,
  thresholds: ConfidenceThresholds,
): Promise<ScreeningMatchResult[]> {
  const query = buildQuery(organizationId, input, subjectField, deps.phoneticEncoder);
  const candidates = await deps.watchlistCandidateRepository.findCandidates(query);

  const results: ScreeningMatchResult[] = [];
  for (const candidate of candidates) {
    const candidateValue = candidateValueForField(candidate, subjectField.field);
    if (candidateValue === null) {
      continue;
    }
    const confidence = scoreMatch(subjectField.field, subjectField.subjectValue, candidateValue, {
      phoneticEncoder: deps.phoneticEncoder,
      similarityCalculator: deps.similarityCalculator,
    });
    const match = createScreeningMatch({
      entryId: candidate.id,
      watchlistId: candidate.watchlistId,
      nombre: candidate.nombre,
      documento: candidate.documento,
      nivelRiesgo: candidate.nivelRiesgo,
      matchField: subjectField.field,
      algorithm: algorithmFor(subjectField.field),
    });
    results.push({
      match,
      confidence,
      tier: tierConfidence(confidence, thresholds),
      alertId: null,
    });
  }
  return results;
}

async function persistAlerts(
  deps: ScreenSubjectAgainstWatchlistDeps,
  input: ScreenSubjectAgainstWatchlistInput,
  thresholds: ConfidenceThresholds,
  results: ScreeningMatchResult[],
): Promise<void> {
  for (const result of results) {
    if (result.tier === 'DISCARD') {
      continue;
    }
    const opened = await deps.openAmlAlert({
      auth: input.auth,
      customerId: input.customerId,
      match: result.match,
      confianza: result.confidence,
      thresholds,
    });
    result.alertId = opened.alert === null ? null : String(opened.alert.id);
  }
}

function buildRiskSignal(sorted: readonly ScreeningMatchResult[]): WatchlistRiskSignal | null {
  const top = sorted.find((result) => result.tier === 'ALERT_AND_SIGNAL');
  if (top === undefined) {
    return null;
  }
  return {
    watchlistHit: true,
    watchlistConfidence: top.confidence,
    watchlistSource: String(top.match.watchlistId),
    watchlistRiskLevel: top.match.nivelRiesgo,
  };
}

/**
 * Screens a subject's presented fields (nombre/documento/walletAddress,
 * whichever are populated) against the org-scoped watchlist: blocking layer
 * (RF-2/RF-5) then in-memory fine scoring (RF-1), confidence tiering (RF-4),
 * idempotent alert persistence via `OpenAmlAlert` (RF-3/RF-6). NEVER blocks
 * autonomously (RF-7) — only returns matches/alerts and, when the top match
 * reaches the signal tier, a `riskSignal` for the caller to fold into a new
 * `CanonicalRiskEvent`.
 */
export function createScreenSubjectAgainstWatchlistUseCase(deps: ScreenSubjectAgainstWatchlistDeps) {
  return async function screenSubject(
    input: ScreenSubjectAgainstWatchlistInput,
  ): Promise<ScreenSubjectAgainstWatchlistResult> {
    const organizationId = requireTenantContext(input.auth);
    const thresholds = input.thresholds ?? deps.thresholds ?? DEFAULT_CONFIDENCE_THRESHOLDS;

    const fields = subjectFields(input);
    const perField = await Promise.all(
      fields.map((subjectField) =>
        scoreCandidatesForField(deps, organizationId, input, subjectField, thresholds),
      ),
    );
    const allResults = perField.flat();
    const sorted = [...allResults].sort((a, b) => b.confidence - a.confidence);

    await persistAlerts(deps, input, thresholds, sorted);

    return {
      matches: sorted,
      riskSignal: buildRiskSignal(sorted),
    };
  };
}

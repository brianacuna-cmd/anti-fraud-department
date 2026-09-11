import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { ScreeningCustomer, ScreeningCustomerSource } from '../domain/ports/ScreeningCustomerSource.js';
import type { ConfidenceThresholds } from '../domain/services/ConfidenceTiering.js';
import type {
  ScreenSubjectAgainstWatchlistInput,
  ScreenSubjectAgainstWatchlistResult,
} from './ScreenSubjectAgainstWatchlist.js';

export interface RescreenCustomerSanctionsInput {
  readonly auth: AuthContext;
}

export interface RescreenCustomerSanctionsDeps {
  readonly customerSource: ScreeningCustomerSource;
  readonly screenSubject: (input: ScreenSubjectAgainstWatchlistInput) => Promise<ScreenSubjectAgainstWatchlistResult>;
  readonly isOrganizationActive: (organizationId: string) => Promise<boolean>;
  /** Per-organization thresholds; when absent `screenSubject` falls back to its own defaults. */
  readonly resolveThresholds?: (organizationId: string) => Promise<ConfidenceThresholds | undefined>;
  readonly onCustomerError?: (customerId: string, error: unknown) => void;
}

export interface RescreenCustomerSanctionsResult {
  readonly skipped: boolean;
  readonly screened: number;
  /** Customers with at least one match at or above the alert threshold. */
  readonly flagged: number;
  readonly failed: number;
}

type ScreeningOutcome = 'flagged' | 'clear' | 'failed';

async function screenCustomer(
  deps: RescreenCustomerSanctionsDeps,
  auth: AuthContext,
  customer: ScreeningCustomer,
  thresholds: ConfidenceThresholds | undefined,
): Promise<ScreeningOutcome> {
  try {
    const result = await deps.screenSubject({
      auth,
      customerId: customer.customerId,
      entryType: customer.entryType,
      name: customer.name,
      ...(thresholds === undefined ? {} : { thresholds }),
    });
    return result.matches.some((match) => match.tier !== 'DISCARD') ? 'flagged' : 'clear';
  } catch (error) {
    deps.onCustomerError?.(customer.customerId, error);
    return 'failed';
  }
}

/**
 * AML-009, the customer half: re-screens every customer's NAME against the
 * organization's watchlists, sanctions lists included, with the same fuzzy
 * engine real-time screening uses.
 *
 * A full pass every night rather than a delta. The wallet rescreen can
 * compare only NEW entries because wallet matching is exact; a name match is
 * fuzzy and goes through the blocking index, so "new entries only" would
 * need a second, delta-scoped candidate query. A full pass is simple and
 * safe because alerts are idempotent on (customer, entry, field): a match
 * already raised — or already resolved as a false positive — is never
 * raised again, so a repeat pass only produces alerts for what is new.
 *
 * One customer failing does not stop the others. The run throws only when
 * EVERY screening failed, which means the matching backend is down rather
 * than one record being bad.
 */
export function createRescreenCustomerSanctionsUseCase(deps: RescreenCustomerSanctionsDeps) {
  return async function rescreenCustomerSanctions(
    input: RescreenCustomerSanctionsInput,
  ): Promise<RescreenCustomerSanctionsResult> {
    const organizationId = input.auth.organizationId;
    if (organizationId === null || !(await deps.isOrganizationActive(organizationId))) {
      return { skipped: true, screened: 0, flagged: 0, failed: 0 };
    }
    const thresholds = await deps.resolveThresholds?.(organizationId);

    const tally: Record<ScreeningOutcome, number> = { flagged: 0, clear: 0, failed: 0 };
    for await (const customer of deps.customerSource.streamCustomers()) {
      tally[await screenCustomer(deps, input.auth, customer, thresholds)] += 1;
    }

    const screened = tally.flagged + tally.clear;
    if (tally.failed > 0 && screened === 0) {
      throw new Error(`customer rescreen failed for all ${tally.failed} customers`);
    }
    return { skipped: false, screened, flagged: tally.flagged, failed: tally.failed };
  };
}

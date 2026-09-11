import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import type {
  ScreeningCustomer,
  ScreeningCustomerSource,
} from '../../../../src/modules/screening/domain/ports/ScreeningCustomerSource.js';
import type { ConfidenceThresholds } from '../../../../src/modules/screening/domain/services/ConfidenceTiering.js';
import type {
  ScreenSubjectAgainstWatchlistInput,
  ScreenSubjectAgainstWatchlistResult,
} from '../../../../src/modules/screening/application/ScreenSubjectAgainstWatchlist.js';
import { createRescreenCustomerSanctionsUseCase } from '../../../../src/modules/screening/application/RescreenCustomerSanctions.js';

const ORG = oid('org-1');
const AUTH = createAuthContext({ userId: 'system:customer-rescreen', organizationId: ORG, actorType: 'ORGANIZATION' });
const THRESHOLDS: ConfidenceThresholds = { alertThreshold: 60, signalThreshold: 85 };

const CUSTOMERS: ScreeningCustomer[] = [
  { customerId: 'c-1', name: 'Juan Perez', entryType: 'PERSON' },
  { customerId: 'c-2', name: 'Acme Trading LLC', entryType: 'ORGANIZATION' },
  { customerId: 'c-3', name: 'Ana Gomez', entryType: 'PERSON' },
];

function source(customers: ScreeningCustomer[]): ScreeningCustomerSource {
  return {
    async *streamCustomers() {
      yield* customers;
    },
  };
}

/** Only `tier` is read by the rescreen, so the rest of the match is left out. */
function resultWith(...tiers: ('DISCARD' | 'ALERT_AND_SIGNAL')[]): ScreenSubjectAgainstWatchlistResult {
  return { matches: tiers.map((tier) => ({ tier }) as never), riskSignal: null };
}

function build(
  screenSubject: (input: ScreenSubjectAgainstWatchlistInput) => Promise<ScreenSubjectAgainstWatchlistResult>,
  options: { active?: boolean; customers?: ScreeningCustomer[] } = {},
) {
  const onCustomerError = jest.fn();
  const rescreen = createRescreenCustomerSanctionsUseCase({
    customerSource: source(options.customers ?? CUSTOMERS),
    screenSubject,
    isOrganizationActive: async () => options.active ?? true,
    resolveThresholds: async () => THRESHOLDS,
    onCustomerError,
  });
  return { rescreen, onCustomerError };
}

describe('RescreenCustomerSanctions (AML-009, customers)', () => {
  it('screens every customer by name, with their entry type and the organization thresholds', async () => {
    const screenSubject = jest.fn(async (_input: ScreenSubjectAgainstWatchlistInput) => resultWith());
    const { rescreen } = build(screenSubject);

    await rescreen({ auth: AUTH });

    expect(screenSubject.mock.calls.map(([input]) => [input.customerId, input.name, input.entryType])).toEqual([
      ['c-1', 'Juan Perez', 'PERSON'],
      ['c-2', 'Acme Trading LLC', 'ORGANIZATION'],
      ['c-3', 'Ana Gomez', 'PERSON'],
    ]);
    expect(screenSubject.mock.calls.every(([input]) => input.thresholds === THRESHOLDS && input.auth === AUTH)).toBe(true);
  });

  it('counts as flagged only the customers with a match at or above the alert threshold', async () => {
    const byCustomer: Record<string, ScreenSubjectAgainstWatchlistResult> = {
      'c-1': resultWith('DISCARD', 'ALERT_AND_SIGNAL'),
      'c-2': resultWith('DISCARD'),
      'c-3': resultWith(),
    };
    const { rescreen } = build(async (input) => byCustomer[input.customerId]!);

    await expect(rescreen({ auth: AUTH })).resolves.toEqual({ skipped: false, screened: 3, flagged: 1, failed: 0 });
  });

  it('does nothing for an inactive organization', async () => {
    const screenSubject = jest.fn(async (_input: ScreenSubjectAgainstWatchlistInput) => resultWith());
    const { rescreen } = build(screenSubject, { active: false });

    await expect(rescreen({ auth: AUTH })).resolves.toEqual({ skipped: true, screened: 0, flagged: 0, failed: 0 });
    expect(screenSubject).not.toHaveBeenCalled();
  });

  it('keeps going when one customer fails, and reports that customer', async () => {
    const boom = new Error('candidate query timed out');
    const { rescreen, onCustomerError } = build(async (input) => {
      if (input.customerId === 'c-2') throw boom;
      return resultWith();
    });

    await expect(rescreen({ auth: AUTH })).resolves.toEqual({ skipped: false, screened: 2, flagged: 0, failed: 1 });
    expect(onCustomerError).toHaveBeenCalledWith('c-2', boom);
  });

  it('fails the run when every screening failed, because that is the backend being down', async () => {
    const { rescreen } = build(async () => {
      throw new Error('connection refused');
    });

    await expect(rescreen({ auth: AUTH })).rejects.toThrow('customer rescreen failed for all 3 customers');
  });
});

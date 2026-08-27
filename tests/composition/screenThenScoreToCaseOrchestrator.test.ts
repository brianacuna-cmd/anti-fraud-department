import { oid } from '../support/oid.js';
import { createAuthContext } from '../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../src/shared/time/Instant.js';
import { createScreenThenScoreToCaseOrchestrator } from '../../src/composition/screenThenScoreToCaseOrchestrator.js';
import type { CanonicalRiskEvent } from '../../src/modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import type { ScoreToCaseOrchestratorResult } from '../../src/composition/scoreToCaseOrchestrator.js';
import type {
  ScreenSubjectAgainstWatchlistInput,
  ScreenSubjectAgainstWatchlistResult,
} from '../../src/modules/screening/application/ScreenSubjectAgainstWatchlist.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const AUTH = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
});

function buildEvent(overrides: Partial<CanonicalRiskEvent> = {}): CanonicalRiskEvent {
  return {
    provider: 'stripe',
    providerEventType: 'CHARGEBACK',
    caseCustomerId: 'cust-1',
    amountCents: 2500,
    currency: 'USD',
    riskSignals: { providerRiskScore: 80 },
    createdAt: NOW,
    ...overrides,
  };
}

const BASE_RESULT: ScoreToCaseOrchestratorResult = {
  riskScore: 88,
  ruleId: 'rule-1',
  conditionsVersion: 2,
  opened: true,
  caseId: 'case-1',
  priority: 'HIGH',
};

describe('createScreenThenScoreToCaseOrchestrator', () => {
  it('enriches riskSignals with a NEW CanonicalRiskEvent when riskSignal is present (confidence >= 70)', async () => {
    const event = buildEvent();
    let receivedEvent: CanonicalRiskEvent | undefined;
    const process = createScreenThenScoreToCaseOrchestrator({
      screenSubject: async (): Promise<ScreenSubjectAgainstWatchlistResult> => ({
        matches: [],
        riskSignal: {
          watchlistHit: true,
          watchlistConfidence: 92,
          watchlistSource: 'watchlist-1',
          watchlistRiskLevel: 'HIGH',
        },
      }),
      scoreToCaseOrchestrator: async (input) => {
        receivedEvent = input.event;
        return BASE_RESULT;
      },
    });

    const result = await process({
      auth: AUTH,
      event,
      screening: { customerId: 'cust-1', entryType: 'PERSON', name: 'John Doe' },
    });

    expect(result).toEqual(BASE_RESULT);
    expect(receivedEvent).not.toBe(event);
    expect(receivedEvent?.riskSignals).toEqual({
      providerRiskScore: 80,
      watchlistHit: true,
      watchlistConfidence: 92,
      watchlistSource: 'watchlist-1',
      watchlistRiskLevel: 'HIGH',
    });
    expect(event.riskSignals).toEqual({ providerRiskScore: 80 });
  });

  it('passes the ORIGINAL event through unchanged when riskSignal is null (confidence in [50,70) or discard)', async () => {
    const event = buildEvent();
    let receivedEvent: CanonicalRiskEvent | undefined;
    const screenCalls: ScreenSubjectAgainstWatchlistInput[] = [];
    const process = createScreenThenScoreToCaseOrchestrator({
      screenSubject: async (input): Promise<ScreenSubjectAgainstWatchlistResult> => {
        screenCalls.push(input);
        return { matches: [], riskSignal: null };
      },
      scoreToCaseOrchestrator: async (input) => {
        receivedEvent = input.event;
        return { ...BASE_RESULT, opened: false, caseId: undefined, priority: undefined };
      },
    });

    const result = await process({
      auth: AUTH,
      event,
      screening: { customerId: 'cust-1', entryType: 'PERSON', name: 'John Doe' },
    });

    expect(result.opened).toBe(false);
    expect(receivedEvent).toBe(event);
    expect(receivedEvent?.riskSignals).toEqual({ providerRiskScore: 80 });
    expect(screenCalls).toHaveLength(1);
    expect(screenCalls[0]?.customerId).toBe('cust-1');
  });

  it('delegates unchanged to scoreToCaseOrchestrator (RF-7): never calls block/approve itself', async () => {
    const scoreToCaseOrchestrator = jest.fn(async () => BASE_RESULT);
    const process = createScreenThenScoreToCaseOrchestrator({
      screenSubject: async () => ({ matches: [], riskSignal: null }),
      scoreToCaseOrchestrator,
    });

    await process({
      auth: AUTH,
      event: buildEvent(),
      screening: { customerId: 'cust-1', entryType: 'PERSON', name: 'John Doe' },
    });

    expect(scoreToCaseOrchestrator).toHaveBeenCalledTimes(1);
  });
});

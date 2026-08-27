import { createWebhookToScoreOrchestrator } from '../../src/composition/webhookToScoreOrchestrator.js';
import { createIngestedPaymentEvent } from '../../src/modules/ingest/domain/model/IngestedPaymentEvent.js';
import { ProviderIngestEvent } from '../../src/modules/ingest/domain/model/aggregates/ProviderIngestEvent.js';
import {
  generateProviderIngestEventId,
  type ProviderIngestEventId,
} from '../../src/modules/ingest/domain/model/value-objects/ProviderIngestEventId.js';
import type { PaymentProvider } from '../../src/modules/ingest/domain/model/value-objects/PaymentProvider.js';
import type { ProviderIngestEventRepository } from '../../src/modules/ingest/domain/ports/ProviderIngestEventRepository.js';
import type { CanonicalRiskEvent } from '../../src/modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import type { AuthContext } from '../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../src/shared/time/Instant.js';
import { FixedClock } from '../helpers/FixedClock.js';
import { oid } from '../support/oid.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-a');
const INGEST_ID = generateProviderIngestEventId();

class InMemoryEvents implements ProviderIngestEventRepository {
  constructor(private row: ProviderIngestEvent | null) {}

  async insertUnique(event: ProviderIngestEvent): Promise<'inserted' | 'duplicate'> {
    this.row = event;
    return 'inserted';
  }

  async save(event: ProviderIngestEvent): Promise<void> {
    this.row = event;
  }

  async findByOrgProviderEvent(
    organizationId: string,
    provider: PaymentProvider,
    providerEventId: string,
  ): Promise<ProviderIngestEvent | null> {
    if (
      this.row &&
      this.row.organizationId === organizationId &&
      this.row.provider === provider &&
      this.row.providerEventId === providerEventId
    ) {
      return this.row;
    }
    return null;
  }

  async findById(id: ProviderIngestEventId): Promise<ProviderIngestEvent | null> {
    if (this.row && this.row.id === id) {
      return this.row;
    }
    return null;
  }

  current(): ProviderIngestEvent | null {
    return this.row;
  }
}

function ingestedCharge() {
  return createIngestedPaymentEvent({
    provider: 'stripe',
    providerEventType: 'charge.succeeded',
    caseCustomerId: 'cus_1',
    amountCents: 2500,
    currency: 'usd',
    riskSignals: { stripeRiskScore: 68, stripeRiskLevel: 'elevated' },
    createdAt: NOW,
    providerEventId: 'evt_charge_succeeded',
    eventId: 'evt_charge_succeeded',
  });
}

function receivedRow(): ProviderIngestEvent {
  return ProviderIngestEvent.create({
    id: INGEST_ID,
    organizationId: ORG,
    provider: 'stripe',
    providerEventId: 'evt_charge_succeeded',
    status: 'RECEIVED',
    now: NOW,
  });
}

describe('webhookToScoreOrchestrator', () => {
  it('invokes score→case with system AuthContext and Stripe 68 only in riskSignals (S07, S21)', async () => {
    const events = new InMemoryEvents(receivedRow());
    const calls: Array<{ auth: AuthContext; event: CanonicalRiskEvent }> = [];
    const composer = createWebhookToScoreOrchestrator({
      processRiskScoreToCase: async (input) => {
        calls.push(input);
        return {
          riskScore: 12,
          ruleId: 'rule-zen',
          conditionsVersion: 1,
          opened: false,
        };
      },
      events,
      clock: new FixedClock(NOW),
    });

    await composer.compose({
      organizationId: ORG,
      provider: 'stripe',
      event: ingestedCharge(),
      ingestEventId: INGEST_ID,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.auth).toMatchObject({
      actorType: 'ORGANIZATION',
      userId: 'system:ingest:stripe',
      organizationId: ORG,
      purpose: 'full',
      roleId: null,
    });
    expect(calls[0]?.event.riskSignals).toEqual({ stripeRiskScore: 68, stripeRiskLevel: 'elevated' });
    expect(calls[0]?.event.amountCents).toBe(2500);
    expect('riskScore' in (calls[0]?.event ?? {})).toBe(false);
    expect(calls[0]?.event.caseCustomerId).toBe('cus_1');
    expect(events.current()?.status).toBe('PROCESSED');
  });

  it('forwards subjectIdentity from IngestedPaymentEvent onto the CanonicalRiskEvent (S07-a)', async () => {
    const events = new InMemoryEvents(receivedRow());
    const calls: Array<{ auth: AuthContext; event: CanonicalRiskEvent }> = [];
    const composer = createWebhookToScoreOrchestrator({
      processRiskScoreToCase: async (input) => {
        calls.push(input);
        return { riskScore: 12, ruleId: 'rule-zen', conditionsVersion: 1, opened: false };
      },
      events,
      clock: new FixedClock(NOW),
    });

    await composer.compose({
      organizationId: ORG,
      provider: 'stripe',
      event: createIngestedPaymentEvent({
        provider: 'stripe',
        providerEventType: 'charge.succeeded',
        caseCustomerId: 'cus_1',
        amountCents: 2500,
        currency: 'usd',
        riskSignals: { stripeRiskScore: 68 },
        createdAt: NOW,
        providerEventId: 'evt_charge_succeeded',
        subjectIdentity: { name: 'John Doe', document: '123456789' },
      }),
      ingestEventId: INGEST_ID,
    });

    expect(calls[0]?.event.subjectIdentity).toEqual({ name: 'John Doe', document: '123456789' });
  });

  it('omits subjectIdentity on the CanonicalRiskEvent when absent from the IngestedPaymentEvent', async () => {
    const events = new InMemoryEvents(receivedRow());
    const calls: Array<{ auth: AuthContext; event: CanonicalRiskEvent }> = [];
    const composer = createWebhookToScoreOrchestrator({
      processRiskScoreToCase: async (input) => {
        calls.push(input);
        return { riskScore: 12, ruleId: 'rule-zen', conditionsVersion: 1, opened: false };
      },
      events,
      clock: new FixedClock(NOW),
    });

    await composer.compose({
      organizationId: ORG,
      provider: 'stripe',
      event: ingestedCharge(),
      ingestEventId: INGEST_ID,
    });

    expect(calls[0]?.event.subjectIdentity).toBeUndefined();
  });

  it('uses system:ingest:{provider} for a non-stripe provider', async () => {
    const events = new InMemoryEvents(
      ProviderIngestEvent.create({
        id: INGEST_ID,
        organizationId: ORG,
        provider: 'bridge',
        providerEventId: 'evt_bridge',
        status: 'RECEIVED',
        now: NOW,
      }),
    );
    const calls: Array<{ auth: AuthContext }> = [];
    const composer = createWebhookToScoreOrchestrator({
      processRiskScoreToCase: async (input) => {
        calls.push(input);
        return { riskScore: 40, ruleId: 'rule-zen', conditionsVersion: 1, opened: false };
      },
      events,
      clock: new FixedClock(NOW),
    });

    await composer.compose({
      organizationId: ORG,
      provider: 'bridge',
      event: createIngestedPaymentEvent({
        provider: 'bridge',
        providerEventType: 'transfer.created',
        caseCustomerId: 'cust_bridge',
        amountCents: 150000,
        currency: 'usd',
        riskSignals: { status: 'posted' },
        createdAt: NOW,
        providerEventId: 'evt_bridge',
      }),
      ingestEventId: INGEST_ID,
    });

    expect(calls[0]?.auth.userId).toBe('system:ingest:bridge');
    expect(calls[0]?.auth.actorType).toBe('ORGANIZATION');
  });

  it('marks the ingest row FAILED when scoring fail-closes and does not rethrow (S18)', async () => {
    const events = new InMemoryEvents(receivedRow());
    const composer = createWebhookToScoreOrchestrator({
      processRiskScoreToCase: async () => {
        throw Object.assign(new Error('no active scoring rule'), { code: 'SCORING_RULE_NOT_FOUND' });
      },
      events,
      clock: new FixedClock(NOW),
    });

    await expect(
      composer.compose({
        organizationId: ORG,
        provider: 'stripe',
        event: ingestedCharge(),
        ingestEventId: INGEST_ID,
      }),
    ).resolves.toBeUndefined();

    expect(events.current()?.status).toBe('FAILED');
  });

  it('resolves and marks the row via ingestEventId even when providerEventId is undefined (REQ-A1 regression)', async () => {
    const events = new InMemoryEvents(receivedRow());
    const composer = createWebhookToScoreOrchestrator({
      processRiskScoreToCase: async () => ({
        riskScore: 12,
        ruleId: 'rule-zen',
        conditionsVersion: 1,
        opened: false,
      }),
      events,
      clock: new FixedClock(NOW),
    });

    await composer.compose({
      organizationId: ORG,
      provider: 'stripe',
      event: createIngestedPaymentEvent({
        provider: 'stripe',
        providerEventType: 'charge.succeeded',
        caseCustomerId: 'cus_1',
        amountCents: 2500,
        currency: 'usd',
        riskSignals: { stripeRiskScore: 68, stripeRiskLevel: 'elevated' },
        createdAt: NOW,
      }),
      ingestEventId: INGEST_ID,
    });

    expect(events.current()?.status).toBe('PROCESSED');
  });

  it('invokes onError with {stage, ingestEventId} and marks FAILED when the composer throws (REQ-A2, REQ-A3.2)', async () => {
    const events = new InMemoryEvents(receivedRow());
    const errors: Array<{ error: unknown; ctx: { stage: string; ingestEventId?: string } }> = [];
    const composer = createWebhookToScoreOrchestrator({
      processRiskScoreToCase: async () => {
        throw new Error('boom');
      },
      events,
      clock: new FixedClock(NOW),
      onError: (error, ctx) => {
        errors.push({ error, ctx });
      },
    });

    await composer.compose({
      organizationId: ORG,
      provider: 'stripe',
      event: ingestedCharge(),
      ingestEventId: INGEST_ID,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.ctx).toMatchObject({ stage: 'compose', ingestEventId: INGEST_ID });
    expect(events.current()?.status).toBe('FAILED');
  });

  it('calls onError and does not throw when findById returns null on success path (observability, not silent)', async () => {
    const events = new InMemoryEvents(null);
    const errors: unknown[] = [];
    const composer = createWebhookToScoreOrchestrator({
      processRiskScoreToCase: async () => ({
        riskScore: 12,
        ruleId: 'rule-zen',
        conditionsVersion: 1,
        opened: false,
      }),
      events,
      clock: new FixedClock(NOW),
      onError: (error) => {
        errors.push(error);
      },
    });

    await expect(
      composer.compose({
        organizationId: ORG,
        provider: 'stripe',
        event: ingestedCharge(),
        ingestEventId: INGEST_ID,
      }),
    ).resolves.toBeUndefined();

    expect(errors).toHaveLength(1);
    expect(events.current()).toBeNull();
  });
});

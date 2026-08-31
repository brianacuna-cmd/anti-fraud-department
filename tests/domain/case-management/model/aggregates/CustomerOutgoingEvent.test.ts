import { oid } from '../../../../support/oid.js';
import { CustomerOutgoingEvent } from '../../../../../src/modules/case-management/domain/model/aggregates/CustomerOutgoingEvent.js';
import { createCustomerOutgoingEventId } from '../../../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { createEnforcementActionId } from '../../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T01:00:00.000Z'));

const MINIMAL_PAYLOAD = {
  enforcement_action_id: oid('action-1'),
  case_id: oid('case-1'),
  action_type: 'BLOCK',
  target_type: 'CUSTOMER',
  target_id: oid('customer-1'),
  organization_id: oid('org-1'),
} as const;

function build(
  overrides: Partial<Parameters<typeof CustomerOutgoingEvent.create>[0]> = {},
): CustomerOutgoingEvent {
  return CustomerOutgoingEvent.create({
    id: createCustomerOutgoingEventId(oid('outbox-1')),
    organizationId: oid('org-1'),
    customerId: oid('customer-1'),
    enforcementActionId: createEnforcementActionId(oid('action-1')),
    webhookUrl: 'https://example.com/hooks/fraud',
    eventType: 'ENFORCEMENT_EXECUTED',
    payload: MINIMAL_PAYLOAD,
    now: NOW,
    ...overrides,
  });
}

const WEBHOOK_TEST_PAYLOAD = {
  event_type: 'WEBHOOK_TEST' as const,
  organization_id: oid('org-1'),
  event_id: oid('outbox-test-1'),
  requested_at: '2026-01-01T00:00:00.000Z',
};

function buildRecordedDelivery(
  overrides: Partial<Parameters<typeof CustomerOutgoingEvent.createRecordedDelivery>[0]> = {},
) {
  return CustomerOutgoingEvent.createRecordedDelivery({
    id: createCustomerOutgoingEventId(oid('outbox-test-1')),
    organizationId: oid('org-1'),
    customerId: 'WEBHOOK_TEST',
    webhookUrl: 'https://example.com/hooks/fraud',
    eventType: 'WEBHOOK_TEST',
    payload: WEBHOOK_TEST_PAYLOAD,
    status: 'SENT',
    responseStatus: 200,
    latencyMs: 42,
    now: NOW,
    ...overrides,
  });
}

describe('CustomerOutgoingEvent.create', () => {
  it('starts PENDING with attempts 0 and the minimal webhook payload', () => {
    const event = build();

    expect(event.status).toBe('PENDING');
    expect(event.attempts).toBe(0);
    expect(event.responseStatus).toBeNull();
    expect(event.lastAttemptAt).toBeNull();
    expect(event.payload).toEqual(MINIMAL_PAYLOAD);
    expect(event.webhookUrl).toBe('https://example.com/hooks/fraud');
    expect(event.enforcementActionId).toBe(createEnforcementActionId(oid('action-1')));
    expect(event.latencyMs).toBeNull();
  });
});

describe('CustomerOutgoingEvent.createRecordedDelivery', () => {
  it('records SENT with attempts 1, null enforcement action, and latency', () => {
    const event = buildRecordedDelivery();

    expect(event.status).toBe('SENT');
    expect(event.attempts).toBe(1);
    expect(event.lastAttemptAt).toBe(NOW);
    expect(event.enforcementActionId).toBeNull();
    expect(event.latencyMs).toBe(42);
    expect(event.responseStatus).toBe(200);
    expect(event.payload).toEqual(WEBHOOK_TEST_PAYLOAD);
    expect(event.customerId).toBe('WEBHOOK_TEST');
    expect(event.eventType).toBe('WEBHOOK_TEST');
  });

  it('records FAILED with attempts 1 and never PENDING', () => {
    const event = buildRecordedDelivery({ status: 'FAILED', responseStatus: 0, latencyMs: 17 });

    expect(event.status).toBe('FAILED');
    expect(event.attempts).toBe(1);
    expect(event.lastAttemptAt).toBe(NOW);
    expect(event.enforcementActionId).toBeNull();
    expect(event.latencyMs).toBe(17);
    expect(event.responseStatus).toBe(0);
  });

  it('rejects PENDING so a test row cannot enter the dispatcher claim set', () => {
    expect(() => buildRecordedDelivery({ status: 'PENDING' as 'SENT' })).toThrow(
      'CustomerOutgoingEvent recorded delivery status must be SENT or FAILED',
    );
  });
});

describe('CustomerOutgoingEvent delivery transitions', () => {
  it('marks SENT on successful delivery', () => {
    const event = build().markSent({ responseStatus: 200, now: LATER });

    expect(event.status).toBe('SENT');
    expect(event.responseStatus).toBe(200);
    expect(event.lastAttemptAt).toBe(LATER);
    expect(event.attempts).toBe(1);
  });

  it('increments attempts and stays PENDING on transient failure before cap', () => {
    const event = build().recordFailure({ responseStatus: 500, now: LATER });

    expect(event.status).toBe('PENDING');
    expect(event.attempts).toBe(1);
    expect(event.responseStatus).toBe(500);
  });

  it('marks FAILED when the 5th attempt fails', () => {
    let event = build();
    for (let i = 0; i < 4; i += 1) {
      event = event.recordFailure({ responseStatus: 500, now: LATER });
    }
    event = event.recordFailure({ responseStatus: 502, now: LATER });

    expect(event.attempts).toBe(5);
    expect(event.status).toBe('FAILED');
  });

  it('rejects markSent from FAILED', () => {
    let event = build();
    for (let i = 0; i < 5; i += 1) {
      event = event.recordFailure({ responseStatus: 500, now: NOW });
    }

    expect(() => event.markSent({ responseStatus: 200, now: LATER })).toThrow('cannot transition');
  });
});

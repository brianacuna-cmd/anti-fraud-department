import { oid } from '../../../support/oid.js';
import { createEnqueueCustomerWebhookFanOut } from '../../../../src/modules/case-management/application/EnqueueCustomerWebhookFanOut.js';
import { CustomerWebhookSubscription } from '../../../../src/modules/case-management/domain/model/aggregates/CustomerWebhookSubscription.js';
import { generateCustomerWebhookSubscriptionId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { generateCustomerOutgoingEventId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { InMemoryCustomerWebhookSubscriptionRepository } from '../../../helpers/case-management/InMemoryCustomerWebhookSubscriptionRepository.js';
import { InMemoryCustomerOutgoingEventRepository } from '../../../helpers/case-management/InMemoryCustomerOutgoingEventRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import type { Transaction } from '../../../../src/modules/case-management/domain/ports/UnitOfWork.js';
import type { WebhookTicketEventType } from '../../../../src/modules/case-management/domain/model/value-objects/WebhookTicketEventType.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');
const TX = {} as Transaction;

function subscription(input: {
  url: string;
  eventTypes: readonly WebhookTicketEventType[];
  active?: boolean;
}): CustomerWebhookSubscription {
  return CustomerWebhookSubscription.create({
    id: generateCustomerWebhookSubscriptionId(),
    organizationId: ORG,
    url: input.url,
    eventTypes: input.eventTypes,
    active: input.active,
    now: NOW,
  });
}

function build() {
  const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
  const outgoingEvents = new InMemoryCustomerOutgoingEventRepository();
  const enqueue = createEnqueueCustomerWebhookFanOut({
    subscriptions,
    outgoingEvents,
    generateCustomerOutgoingEventId,
  });
  return { subscriptions, outgoingEvents, enqueue };
}

describe('EnqueueCustomerWebhookFanOut', () => {
  it('inserts one PENDING row per ACTIVE subscription matching case.created', async () => {
    const { subscriptions, outgoingEvents, enqueue } = build();
    await subscriptions.create(
      subscription({ url: 'https://hooks.example/a', eventTypes: ['case.created'] }),
    );
    await subscriptions.create(
      subscription({ url: 'https://hooks.example/b', eventTypes: ['case.created', 'case.resolved'] }),
    );
    await subscriptions.create(
      subscription({ url: 'https://hooks.example/inactive', eventTypes: ['case.created'], active: false }),
    );
    await subscriptions.create(
      subscription({ url: 'https://hooks.example/aml-only', eventTypes: ['aml.alert_generated'] }),
    );

    await enqueue({
      organizationId: ORG,
      customerId: oid('customer-1'),
      eventType: 'case.created',
      kafkaFacts: { caseId: oid('case-1'), customerId: oid('customer-1'), riskScore: 42 },
      now: NOW,
      tx: TX,
    });

    const rows = outgoingEvents.all();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'PENDING')).toBe(true);
    expect(rows.every((row) => row.enforcementActionId === null)).toBe(true);
    expect(rows.map((row) => row.webhookUrl).sort()).toEqual([
      'https://hooks.example/a',
      'https://hooks.example/b',
    ]);
    expect(rows.every((row) => row.eventType === 'case.created')).toBe(true);
    expect(rows[0]!.payload).toMatchObject({
      event_type: 'case.created',
      organization_id: ORG,
      caseId: oid('case-1'),
    });
    expect(rows.every((row) => row.eventType !== 'ENFORCEMENT_EXECUTED')).toBe(true);
  });

  it('inserts zero rows when no ACTIVE subscription lists the event type', async () => {
    const { subscriptions, outgoingEvents, enqueue } = build();
    await subscriptions.create(
      subscription({ url: 'https://hooks.example/resolved', eventTypes: ['case.resolved'] }),
    );

    await enqueue({
      organizationId: ORG,
      customerId: oid('customer-1'),
      eventType: 'case.created',
      kafkaFacts: { caseId: oid('case-1') },
      now: NOW,
      tx: TX,
    });

    expect(outgoingEvents.all()).toHaveLength(0);
  });
});

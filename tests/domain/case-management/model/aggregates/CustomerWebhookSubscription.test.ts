import { oid } from '../../../../support/oid.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { CustomerWebhookSubscription } from '../../../../../src/modules/case-management/domain/model/aggregates/CustomerWebhookSubscription.js';
import { generateCustomerWebhookSubscriptionId } from '../../../../../src/modules/case-management/domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import {
  createWebhookTicketEventType,
  type WebhookTicketEventType,
} from '../../../../../src/modules/case-management/domain/model/value-objects/WebhookTicketEventType.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const WEBHOOK_URL = 'https://hooks.example.com/notify';

function create(
  overrides: Partial<Parameters<typeof CustomerWebhookSubscription.create>[0]> = {},
): CustomerWebhookSubscription {
  return CustomerWebhookSubscription.create({
    id: generateCustomerWebhookSubscriptionId(),
    organizationId: oid('org-1'),
    url: WEBHOOK_URL,
    eventTypes: ['case.created'],
    now: NOW,
    ...overrides,
  });
}

describe('createWebhookTicketEventType', () => {
  it.each(['case.created', 'case.resolved', 'aml.alert_generated'] as const)(
    'accepts ticket name %s',
    (value) => {
      expect(createWebhookTicketEventType(value)).toBe(value);
    },
  );

  it.each(['CASE_RESOLVED', 'AML_ALERT_CREATED', '', 'case.updated'])(
    'rejects non-ticket name %s',
    (value) => {
      expect(() => createWebhookTicketEventType(value)).toThrow(CaseManagementError);
      expect(() => createWebhookTicketEventType(value)).toThrow(/WebhookTicketEventType/);
    },
  );
});

describe('CustomerWebhookSubscription.create', () => {
  it('defaults active to true', () => {
    const subscription = create();

    expect(subscription.active).toBe(true);
    expect(subscription.url).toBe(WEBHOOK_URL);
    expect(subscription.eventTypes).toEqual(['case.created']);
    expect(subscription.createdAt).toBe(NOW);
    expect(subscription.updatedAt).toBe(NOW);
  });

  it('retains an explicit inactive flag', () => {
    const subscription = create({ active: false });

    expect(subscription.active).toBe(false);
  });

  it('accepts every allowed ticket event type', () => {
    const eventTypes: readonly WebhookTicketEventType[] = [
      'case.created',
      'case.resolved',
      'aml.alert_generated',
    ];
    const subscription = create({ eventTypes });

    expect(subscription.eventTypes).toEqual(eventTypes);
  });

  it('rejects empty eventTypes', () => {
    expect(() => create({ eventTypes: [] })).toThrow(CaseManagementError);
    expect(() => create({ eventTypes: [] })).toThrow(/eventTypes/);
  });

  it('rejects Kafka SCREAMING names CASE_RESOLVED and AML_ALERT_CREATED', () => {
    expect(() =>
      create({ eventTypes: [createWebhookTicketEventType('CASE_RESOLVED')] }),
    ).toThrow(CaseManagementError);
    expect(() =>
      create({ eventTypes: [createWebhookTicketEventType('AML_ALERT_CREATED')] }),
    ).toThrow(CaseManagementError);
  });

  it('rejects an empty organizationId', () => {
    expect(() => create({ organizationId: '  ' })).toThrow(/organizationId/);
  });

  it('rejects a non-http(s) URL', () => {
    expect(() => create({ url: 'ftp://hooks.example.com/notify' })).toThrow(CaseManagementError);
    expect(() => create({ url: 'not-a-url' })).toThrow(/url/);
  });
});

describe('CustomerWebhookSubscription.rehydrate', () => {
  it('reconstructs from stored props without re-validating', () => {
    const subscription = CustomerWebhookSubscription.rehydrate({
      id: generateCustomerWebhookSubscriptionId(),
      organizationId: oid('org-1'),
      url: WEBHOOK_URL,
      eventTypes: ['case.resolved'],
      active: false,
      createdAt: NOW,
      updatedAt: LATER,
    });

    expect(subscription.active).toBe(false);
    expect(subscription.eventTypes).toEqual(['case.resolved']);
    expect(subscription.updatedAt).toBe(LATER);
  });
});

describe('CustomerWebhookSubscription#update', () => {
  it('returns a new instance with bumped updatedAt and mutated fields', () => {
    const subscription = create();

    const updated = subscription.update(
      {
        url: 'https://hooks.example.com/other',
        eventTypes: ['case.resolved', 'aml.alert_generated'],
        active: false,
      },
      LATER,
    );

    expect(updated).not.toBe(subscription);
    expect(updated.url).toBe('https://hooks.example.com/other');
    expect(updated.eventTypes).toEqual(['case.resolved', 'aml.alert_generated']);
    expect(updated.active).toBe(false);
    expect(updated.updatedAt).toBe(LATER);
    expect(subscription.active).toBe(true);
    expect(subscription.url).toBe(WEBHOOK_URL);
  });

  it('rejects empty eventTypes on update', () => {
    const subscription = create();

    expect(() => subscription.update({ eventTypes: [] }, LATER)).toThrow(/eventTypes/);
  });
});

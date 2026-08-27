import {
  createWebhookSubscriptionSchema,
  listWebhookSubscriptionsQuerySchema,
  updateWebhookSubscriptionSchema,
} from '../../../src/modules/case-management/infrastructure/adapters/inbound/http/dto/webhookSubscriptionSchemas.js';

describe('webhookSubscriptionSchemas', () => {
  it('accepts a create body with url and a non-empty subset of ticket names', () => {
    const result = createWebhookSubscriptionSchema.safeParse({
      url: 'https://hooks.example.com/cases',
      eventTypes: ['case.created', 'aml.alert_generated'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://hooks.example.com/cases');
      expect(result.data.eventTypes).toEqual(['case.created', 'aml.alert_generated']);
      expect(result.data.active).toBeUndefined();
    }
  });

  it('rejects empty eventTypes', () => {
    const result = createWebhookSubscriptionSchema.safeParse({
      url: 'https://hooks.example.com/cases',
      eventTypes: [],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non-http(s) URL', () => {
    expect(
      createWebhookSubscriptionSchema.safeParse({
        url: 'ftp://hooks.example.com/cases',
        eventTypes: ['case.created'],
      }).success,
    ).toBe(false);
    expect(
      createWebhookSubscriptionSchema.safeParse({
        url: 'not-a-url',
        eventTypes: ['case.created'],
      }).success,
    ).toBe(false);
  });

  it('rejects Kafka SCREAMING event names', () => {
    expect(
      createWebhookSubscriptionSchema.safeParse({
        url: 'https://hooks.example.com/cases',
        eventTypes: ['CASE_RESOLVED'],
      }).success,
    ).toBe(false);
    expect(
      createWebhookSubscriptionSchema.safeParse({
        url: 'https://hooks.example.com/cases',
        eventTypes: ['AML_ALERT_CREATED'],
      }).success,
    ).toBe(false);
  });

  it('accepts PATCH of url, eventTypes, and active', () => {
    const result = updateWebhookSubscriptionSchema.safeParse({
      url: 'https://hooks.example.com/patched',
      eventTypes: ['case.resolved'],
      active: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://hooks.example.com/patched');
      expect(result.data.eventTypes).toEqual(['case.resolved']);
      expect(result.data.active).toBe(false);
    }
  });

  it('rejects PATCH with empty eventTypes or Kafka names', () => {
    expect(updateWebhookSubscriptionSchema.safeParse({ eventTypes: [] }).success).toBe(false);
    expect(updateWebhookSubscriptionSchema.safeParse({ eventTypes: ['CASE_RESOLVED'] }).success).toBe(
      false,
    );
  });

  it('parses optional list query active from Express strings', () => {
    expect(listWebhookSubscriptionsQuerySchema.parse({}).active).toBeUndefined();
    expect(listWebhookSubscriptionsQuerySchema.parse({ active: 'true' }).active).toBe(true);
    expect(listWebhookSubscriptionsQuerySchema.parse({ active: 'false' }).active).toBe(false);
  });
});

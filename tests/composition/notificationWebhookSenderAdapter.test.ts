import { oid } from '../support/oid.js';
import { createNotificationWebhookSenderAdapter } from '../../src/composition/notificationWebhookSenderAdapter.js';
import { InMemoryNotificationOrgConfigRepository } from '../helpers/notifications/InMemoryNotificationOrgConfigRepository.js';
import { NotificationOrgConfig } from '../../src/modules/notifications/domain/model/aggregates/NotificationOrgConfig.js';
import { generateNotificationOrgConfigId } from '../../src/modules/notifications/domain/model/value-objects/NotificationOrgConfigId.js';
import { createOrganizationId } from '../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { fromDate } from '../../src/shared/time/Instant.js';

describe('createNotificationWebhookSenderAdapter', () => {
  const organizationId = createOrganizationId(oid('org-1'));
  const recipientUserId = createUserId(oid('user-1'));

  function seedConfig(repo: InMemoryNotificationOrgConfigRepository, webhookUrl: string | null): void {
    repo.seed(
      NotificationOrgConfig.create({
        id: generateNotificationOrgConfigId(),
        organizationId,
        webhookUrl,
        secret: null,
        now: fromDate(new Date()),
      }),
    );
  }

  it('POSTs a {text, alertType, context} JSON body to the configured webhookUrl', async () => {
    const repo = new InMemoryNotificationOrgConfigRepository();
    seedConfig(repo, 'https://hooks.example.com/x');
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const sender = createNotificationWebhookSenderAdapter(repo, { fetchImpl });
    await sender.send({
      organizationId,
      recipientUserId,
      alertType: 'CASE_ASSIGNED',
      context: { caseId: oid('case-1') },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://hooks.example.com/x');
    const body = JSON.parse(calls[0].init.body as string) as {
      text: string;
      alertType: string;
      context: Record<string, unknown>;
    };
    expect(typeof body.text).toBe('string');
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.alertType).toBe('CASE_ASSIGNED');
    expect(body.context).toEqual({ caseId: oid('case-1') });
  });

  it('does not POST when the org has no config row (no-op)', async () => {
    const repo = new InMemoryNotificationOrgConfigRepository();
    const fetchImpl = jest.fn();

    const sender = createNotificationWebhookSenderAdapter(repo, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(
      sender.send({ organizationId, recipientUserId, alertType: 'CASE_ASSIGNED', context: {} }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not POST when the org config has webhookUrl: null (no-op)', async () => {
    const repo = new InMemoryNotificationOrgConfigRepository();
    seedConfig(repo, null);
    const fetchImpl = jest.fn();

    const sender = createNotificationWebhookSenderAdapter(repo, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(
      sender.send({ organizationId, recipientUserId, alertType: 'CASE_ASSIGNED', context: {} }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx response', async () => {
    const repo = new InMemoryNotificationOrgConfigRepository();
    seedConfig(repo, 'https://hooks.example.com/x');
    const fetchImpl = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;

    const sender = createNotificationWebhookSenderAdapter(repo, { fetchImpl });
    await expect(
      sender.send({ organizationId, recipientUserId, alertType: 'CASE_ASSIGNED', context: {} }),
    ).rejects.toThrow();
  });

  it('throws on a network error', async () => {
    const repo = new InMemoryNotificationOrgConfigRepository();
    seedConfig(repo, 'https://hooks.example.com/x');
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const sender = createNotificationWebhookSenderAdapter(repo, { fetchImpl });
    await expect(
      sender.send({ organizationId, recipientUserId, alertType: 'CASE_ASSIGNED', context: {} }),
    ).rejects.toThrow();
  });
});

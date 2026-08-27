import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createUpdateWebhookSubscriptionUseCase } from '../../../../src/modules/case-management/application/UpdateWebhookSubscription.js';
import { CustomerWebhookSubscription } from '../../../../src/modules/case-management/domain/model/aggregates/CustomerWebhookSubscription.js';
import { generateCustomerWebhookSubscriptionId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { InMemoryCustomerWebhookSubscriptionRepository } from '../../../helpers/case-management/InMemoryCustomerWebhookSubscriptionRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryUnitOfWork } from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/case-management/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/case-management/domain/ports/UnitOfWork.js';

const ORG = oid('org-1');
const OTHER_ORG = oid('org-2');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-02-01T00:00:00.000Z'));

function supervisorAuth(organizationId = ORG) {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId,
    roleId: 'SUPERVISOR',
    ipAddress: '10.0.0.1',
  });
}

async function seed(
  repo: InMemoryCustomerWebhookSubscriptionRepository,
  organizationId: string,
  url: string,
  active = true,
): Promise<CustomerWebhookSubscription> {
  const subscription = CustomerWebhookSubscription.create({
    id: generateCustomerWebhookSubscriptionId(),
    organizationId,
    url,
    eventTypes: ['case.created'],
    active,
    now: NOW,
  });
  await repo.create(subscription);
  return subscription;
}

function buildUseCase() {
  const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = new InMemoryUnitOfWork();
  const update = createUpdateWebhookSubscriptionUseCase({
    subscriptions,
    auditRecorder,
    unitOfWork,
    clock: new FixedClock(LATER),
  });
  return { subscriptions, auditRecorder, unitOfWork, update };
}

describe('createUpdateWebhookSubscriptionUseCase', () => {
  it('updates url, eventTypes, and active on a same-org row and audits UPDATE', async () => {
    const { subscriptions, auditRecorder, unitOfWork, update } = buildUseCase();
    const existing = await seed(subscriptions, ORG, 'https://hooks.example.com/a');

    const updated = await update({
      auth: supervisorAuth(),
      subscriptionId: String(existing.id),
      url: 'https://hooks.example.com/patched',
      eventTypes: ['case.resolved', 'aml.alert_generated'],
      active: false,
    });

    expect(updated.url).toBe('https://hooks.example.com/patched');
    expect(updated.eventTypes).toEqual(['case.resolved', 'aml.alert_generated']);
    expect(updated.active).toBe(false);
    expect(updated.updatedAt).toBe(LATER);
    expect(unitOfWork.transactionCount).toBe(1);
    expect(auditRecorder.all()).toEqual([
      expect.objectContaining({
        action: 'UPDATE_WEBHOOK_SUBSCRIPTION',
        resource: 'webhook_subscription',
        resourceId: String(existing.id),
        detail: {
          url: 'https://hooks.example.com/patched',
          eventTypes: ['case.resolved', 'aml.alert_generated'],
          active: false,
        },
      }),
    ]);
  });

  it('treats deactivate as UPDATE, not DELETE', async () => {
    const { subscriptions, auditRecorder, update } = buildUseCase();
    const existing = await seed(subscriptions, ORG, 'https://hooks.example.com/a');

    const updated = await update({
      auth: supervisorAuth(),
      subscriptionId: String(existing.id),
      active: false,
    });

    expect(updated.active).toBe(false);
    expect(subscriptions.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]?.action).toBe('UPDATE_WEBHOOK_SUBSCRIPTION');
    expect(auditRecorder.all()[0]?.action).not.toBe('DELETE_WEBHOOK_SUBSCRIPTION');
  });

  it('hides a cross-tenant update as WEBHOOK_SUBSCRIPTION_NOT_FOUND with no audit', async () => {
    const { subscriptions, auditRecorder, update } = buildUseCase();
    const other = await seed(subscriptions, OTHER_ORG, 'https://hooks.example.com/a');

    await expect(
      update({
        auth: supervisorAuth(),
        subscriptionId: String(other.id),
        active: false,
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SUBSCRIPTION_NOT_FOUND' });

    expect(auditRecorder.all()).toHaveLength(0);
    expect((await subscriptions.findById(other.id))?.active).toBe(true);
  });

  it('rejects renaming to a URL already used in the same org', async () => {
    const { subscriptions, update } = buildUseCase();
    await seed(subscriptions, ORG, 'https://hooks.example.com/taken');
    const target = await seed(subscriptions, ORG, 'https://hooks.example.com/mine');

    await expect(
      update({
        auth: supervisorAuth(),
        subscriptionId: String(target.id),
        url: 'https://hooks.example.com/taken',
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SUBSCRIPTION_URL_TAKEN' });
  });

  it('threads the same transaction handle into save() and auditRecorder.record()', async () => {
    const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
    const existing = await seed(subscriptions, ORG, 'https://hooks.example.com/a');
    const seenTx: Array<Transaction | undefined> = [];
    const auditRecorder: AuditRecorder = {
      record: async (event: AuditEvent, tx?: Transaction) => {
        seenTx.push(tx);
        void event;
      },
    };
    const originalSave = subscriptions.save.bind(subscriptions);
    subscriptions.save = async (subscription, tx) => {
      seenTx.push(tx);
      return originalSave(subscription, tx);
    };
    const update = createUpdateWebhookSubscriptionUseCase({
      subscriptions,
      auditRecorder,
      unitOfWork: new InMemoryUnitOfWork(),
      clock: new FixedClock(LATER),
    });

    await update({
      auth: supervisorAuth(),
      subscriptionId: String(existing.id),
      active: false,
    });

    expect(seenTx).toHaveLength(2);
    expect(seenTx[0]).toBeDefined();
    expect(seenTx[0]).toBe(seenTx[1]);
  });
});

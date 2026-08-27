import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createDeleteWebhookSubscriptionUseCase } from '../../../../src/modules/case-management/application/DeleteWebhookSubscription.js';
import { CustomerWebhookSubscription } from '../../../../src/modules/case-management/domain/model/aggregates/CustomerWebhookSubscription.js';
import { generateCustomerWebhookSubscriptionId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { InMemoryCustomerWebhookSubscriptionRepository } from '../../../helpers/case-management/InMemoryCustomerWebhookSubscriptionRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryUnitOfWork } from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/case-management/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/case-management/domain/ports/UnitOfWork.js';

const ORG = oid('org-1');
const OTHER_ORG = oid('org-2');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

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
): Promise<CustomerWebhookSubscription> {
  const subscription = CustomerWebhookSubscription.create({
    id: generateCustomerWebhookSubscriptionId(),
    organizationId,
    url,
    eventTypes: ['case.created'],
    now: NOW,
  });
  await repo.create(subscription);
  return subscription;
}

function buildUseCase() {
  const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = new InMemoryUnitOfWork();
  const remove = createDeleteWebhookSubscriptionUseCase({
    subscriptions,
    auditRecorder,
    unitOfWork,
  });
  return { subscriptions, auditRecorder, unitOfWork, remove };
}

describe('createDeleteWebhookSubscriptionUseCase', () => {
  it('hard-deletes a same-org row and audits DELETE in one transaction', async () => {
    const { subscriptions, auditRecorder, unitOfWork, remove } = buildUseCase();
    const existing = await seed(subscriptions, ORG, 'https://hooks.example.com/a');

    const deleted = await remove({
      auth: supervisorAuth(),
      subscriptionId: String(existing.id),
    });

    expect(deleted.id).toBe(existing.id);
    expect(subscriptions.all()).toHaveLength(0);
    expect(unitOfWork.transactionCount).toBe(1);
    expect(auditRecorder.all()).toEqual([
      expect.objectContaining({
        action: 'DELETE_WEBHOOK_SUBSCRIPTION',
        resource: 'webhook_subscription',
        resourceId: String(existing.id),
        detail: { url: existing.url, eventTypes: ['case.created'], active: true },
      }),
    ]);
  });

  it('hides a cross-tenant delete as WEBHOOK_SUBSCRIPTION_NOT_FOUND', async () => {
    const { subscriptions, auditRecorder, remove } = buildUseCase();
    const other = await seed(subscriptions, OTHER_ORG, 'https://hooks.example.com/a');

    await expect(
      remove({ auth: supervisorAuth(), subscriptionId: String(other.id) }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SUBSCRIPTION_NOT_FOUND' });

    expect(subscriptions.all()).toHaveLength(1);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('404s for a missing id', async () => {
    const { remove } = buildUseCase();

    await expect(
      remove({ auth: supervisorAuth(), subscriptionId: oid('missing-subscription') }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SUBSCRIPTION_NOT_FOUND' });
  });

  it('threads the same transaction handle into delete() and auditRecorder.record()', async () => {
    const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
    const existing = await seed(subscriptions, ORG, 'https://hooks.example.com/a');
    const seenTx: Array<Transaction | undefined> = [];
    const auditRecorder: AuditRecorder = {
      record: async (event: AuditEvent, tx?: Transaction) => {
        seenTx.push(tx);
        void event;
      },
    };
    const originalDelete = subscriptions.delete.bind(subscriptions);
    subscriptions.delete = async (id, tx) => {
      seenTx.push(tx);
      return originalDelete(id, tx);
    };
    const remove = createDeleteWebhookSubscriptionUseCase({
      subscriptions,
      auditRecorder,
      unitOfWork: new InMemoryUnitOfWork(),
    });

    await remove({ auth: supervisorAuth(), subscriptionId: String(existing.id) });

    expect(seenTx).toHaveLength(2);
    expect(seenTx[0]).toBeDefined();
    expect(seenTx[0]).toBe(seenTx[1]);
  });
});

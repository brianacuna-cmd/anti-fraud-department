import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createCreateWebhookSubscriptionUseCase } from '../../../../src/modules/case-management/application/CreateWebhookSubscription.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
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
const URL_A = 'https://hooks.example.com/a';
const URL_B = 'https://hooks.example.com/b';

function supervisorAuth(organizationId = ORG) {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId,
    roleId: 'SUPERVISOR',
    ipAddress: '10.0.0.1',
  });
}

function buildUseCase(overrides: {
  readonly subscriptions?: InMemoryCustomerWebhookSubscriptionRepository;
  readonly auditRecorder?: AuditRecorder;
  readonly unitOfWork?: InMemoryUnitOfWork;
} = {}) {
  const subscriptions = overrides.subscriptions ?? new InMemoryCustomerWebhookSubscriptionRepository();
  const auditRecorder = overrides.auditRecorder ?? new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = overrides.unitOfWork ?? new InMemoryUnitOfWork();
  const create = createCreateWebhookSubscriptionUseCase({
    subscriptions,
    auditRecorder,
    unitOfWork,
    clock: new FixedClock(NOW),
    generateCustomerWebhookSubscriptionId,
  });
  return { subscriptions, auditRecorder, unitOfWork, create };
}

describe('createCreateWebhookSubscriptionUseCase', () => {
  it('persists an active row for the caller org and writes CREATE audit in one transaction', async () => {
    const { subscriptions, auditRecorder, unitOfWork, create } = buildUseCase();

    const created = await create({
      auth: supervisorAuth(),
      url: URL_A,
      eventTypes: ['case.created'],
    });

    expect(created.organizationId).toBe(ORG);
    expect(created.url).toBe(URL_A);
    expect(created.eventTypes).toEqual(['case.created']);
    expect(created.active).toBe(true);
    expect(subscriptions.all()).toHaveLength(1);
    expect(unitOfWork.transactionCount).toBe(1);
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toEqual([
      expect.objectContaining({
        action: 'CREATE_WEBHOOK_SUBSCRIPTION',
        resource: 'webhook_subscription',
        resourceId: String(created.id),
        organizationId: ORG,
        detail: { url: URL_A, eventTypes: ['case.created'], active: true },
      }),
    ]);
  });

  it('honors an explicit inactive create', async () => {
    const { create } = buildUseCase();

    const created = await create({
      auth: supervisorAuth(),
      url: URL_A,
      eventTypes: ['case.resolved'],
      active: false,
    });

    expect(created.active).toBe(false);
  });

  it('rejects a duplicate URL in the same org without a second row or audit', async () => {
    const { subscriptions, auditRecorder, create } = buildUseCase();
    await create({ auth: supervisorAuth(), url: URL_A, eventTypes: ['case.created'] });
    const recorder = auditRecorder as InMemoryCaseManagementAuditRecorder;
    expect(recorder.all()).toHaveLength(1);

    await expect(
      create({ auth: supervisorAuth(), url: URL_A, eventTypes: ['aml.alert_generated'] }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SUBSCRIPTION_URL_TAKEN' });

    expect(subscriptions.all()).toHaveLength(1);
    expect(recorder.all()).toHaveLength(1);
  });

  it('allows the same URL in a different organization', async () => {
    const { subscriptions, create } = buildUseCase();
    await create({ auth: supervisorAuth(), url: URL_A, eventTypes: ['case.created'] });

    const other = await create({
      auth: supervisorAuth(OTHER_ORG),
      url: URL_A,
      eventTypes: ['case.created'],
    });

    expect(other.organizationId).toBe(OTHER_ORG);
    expect(subscriptions.all()).toHaveLength(2);
  });

  it('rejects ANALYST without persisting', async () => {
    const { subscriptions, create } = buildUseCase();

    try {
      await create({
        auth: createAuthContext({
          userId: oid('user-1'),
          organizationId: ORG,
          roleId: 'ANALYST',
        }),
        url: URL_B,
        eventTypes: ['case.created'],
      });
      throw new Error('expected create to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
    expect(subscriptions.all()).toHaveLength(0);
  });

  it('threads the same transaction handle into create() and auditRecorder.record()', async () => {
    const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
    const seenTx: Array<Transaction | undefined> = [];
    const auditRecorder: AuditRecorder = {
      record: async (event: AuditEvent, tx?: Transaction) => {
        seenTx.push(tx);
        void event;
      },
    };
    const originalCreate = subscriptions.create.bind(subscriptions);
    subscriptions.create = async (subscription, tx) => {
      seenTx.push(tx);
      return originalCreate(subscription, tx);
    };
    const { create } = buildUseCase({ subscriptions, auditRecorder });

    await create({ auth: supervisorAuth(), url: URL_A, eventTypes: ['case.created'] });

    expect(seenTx).toHaveLength(2);
    expect(seenTx[0]).toBeDefined();
    expect(seenTx[0]).toBe(seenTx[1]);
  });
});

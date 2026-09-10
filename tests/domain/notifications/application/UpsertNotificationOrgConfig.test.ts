import { oid } from '../../../support/oid.js';
import { createUpsertNotificationOrgConfigUseCase } from '../../../../src/modules/notifications/application/UpsertNotificationOrgConfig.js';
import { InMemoryNotificationOrgConfigRepository } from '../../../helpers/notifications/InMemoryNotificationOrgConfigRepository.js';
import { InMemoryUnitOfWork } from '../../../helpers/notifications/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/notifications/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { NotificationsError } from '../../../../src/modules/notifications/domain/errors/NotificationsError.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const UPDATED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));

const SUPERVISOR_ORG_1 = createAuthContext({
  userId: oid('user-1'),
  organizationId: oid('org-1'),
  roleId: 'SUPERVISOR',
});
const ANALYST_ORG_1 = createAuthContext({
  userId: oid('user-2'),
  organizationId: oid('org-1'),
  roleId: 'ANALYST',
});

function buildUseCase(repository: InMemoryNotificationOrgConfigRepository, now = UPDATED_AT) {
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const upsert = createUpsertNotificationOrgConfigUseCase({
    repository,
    unitOfWork,
    clock: new FixedClock(now),
    auditRecorder,
  });
  return { upsert, unitOfWork, auditRecorder };
}

describe('createUpsertNotificationOrgConfigUseCase', () => {
  it('403s when caller role is not in SUPERVISION_ROLES', async () => {
    const repository = new InMemoryNotificationOrgConfigRepository();
    const { upsert } = buildUseCase(repository);

    await expect(
      upsert({ auth: ANALYST_ORG_1, webhookUrl: 'https://hooks.example.com/x' }),
    ).rejects.toBeInstanceOf(NotificationsError);
    const stored = await repository.findByOrganization(oid('org-1') as never);
    expect(stored).toBeNull();
  });

  it('upserts and records exactly one NOTIFICATION_ORG_CONFIG_UPDATED audit event in the same tx', async () => {
    const repository = new InMemoryNotificationOrgConfigRepository();
    const { upsert, auditRecorder, unitOfWork } = buildUseCase(repository, CREATED_AT);

    const config = await upsert({ auth: SUPERVISOR_ORG_1, webhookUrl: 'https://hooks.example.com/x' });

    expect(config.webhookUrl).toBe('https://hooks.example.com/x');
    expect(unitOfWork.transactionCount).toBe(1);
    const events = auditRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('NOTIFICATION_ORG_CONFIG_UPDATED');
    expect(events[0]?.resource).toBe('notificationOrgConfig');
  });

  it('rejects an invalid webhookUrl before persistence, with no write and no audit entry', async () => {
    const repository = new InMemoryNotificationOrgConfigRepository();
    const { upsert, auditRecorder } = buildUseCase(repository);

    await expect(
      upsert({ auth: SUPERVISOR_ORG_1, webhookUrl: 'ftp://host/x' }),
    ).rejects.toBeInstanceOf(NotificationsError);
    const stored = await repository.findByOrganization(oid('org-1') as never);
    expect(stored).toBeNull();
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('is self-scoped to the caller org (no cross-org write path)', async () => {
    const repository = new InMemoryNotificationOrgConfigRepository();
    const { upsert } = buildUseCase(repository);

    await upsert({ auth: SUPERVISOR_ORG_1, webhookUrl: 'https://hooks.example.com/x' });

    const otherOrgConfig = await repository.findByOrganization(oid('org-2') as never);
    expect(otherOrgConfig).toBeNull();
  });

  it('re-submission updates the existing row in place rather than creating a duplicate', async () => {
    const repository = new InMemoryNotificationOrgConfigRepository();
    const { upsert } = buildUseCase(repository, CREATED_AT);
    await upsert({ auth: SUPERVISOR_ORG_1, webhookUrl: 'https://hooks.example.com/first' });

    const { upsert: upsertAgain } = buildUseCase(repository, UPDATED_AT);
    const updated = await upsertAgain({ auth: SUPERVISOR_ORG_1, webhookUrl: 'https://hooks.example.com/second' });

    expect(updated.webhookUrl).toBe('https://hooks.example.com/second');
    expect(updated.createdAt).toBe(CREATED_AT);
    expect(updated.updatedAt).toBe(UPDATED_AT);
  });
});

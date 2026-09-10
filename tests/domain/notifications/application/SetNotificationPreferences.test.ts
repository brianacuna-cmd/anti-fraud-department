import { oid } from '../../../support/oid.js';
import { createSetNotificationPreferencesUseCase } from '../../../../src/modules/notifications/application/SetNotificationPreferences.js';
import { InMemoryNotificationPreferenceRepository } from '../../../helpers/notifications/InMemoryNotificationPreferenceRepository.js';
import { InMemoryUnitOfWork } from '../../../helpers/notifications/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/notifications/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { createAlertType } from '../../../../src/modules/notifications/domain/model/value-objects/AlertType.js';
import { createNotificationChannel } from '../../../../src/modules/notifications/domain/model/value-objects/NotificationChannel.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_1_USER = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1') });

function buildUseCase(repository: InMemoryNotificationPreferenceRepository, now = NOW) {
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const setPreferences = createSetNotificationPreferencesUseCase({
    repository,
    unitOfWork,
    clock: new FixedClock(now),
    auditRecorder,
  });
  return { setPreferences, unitOfWork, auditRecorder };
}

describe('createSetNotificationPreferencesUseCase (bulk)', () => {
  it('applies all entries atomically: N upserts + N audit rows in one withTransaction', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const { setPreferences, unitOfWork, auditRecorder } = buildUseCase(repository);

    const result = await setPreferences({
      auth: ORG_1_USER,
      entries: [
        { alertType: 'CASE_ASSIGNED', channel: 'SLACK', enabled: false },
        { alertType: 'CRITICAL_RISK', channel: 'WEBHOOK', enabled: true },
      ],
    });

    expect(unitOfWork.transactionCount).toBe(1);
    expect(auditRecorder.all()).toHaveLength(2);
    expect(auditRecorder.all().map((event) => event.action)).toEqual([
      'NOTIFICATION_PREFERENCE_UPDATED',
      'NOTIFICATION_PREFERENCE_UPDATED',
    ]);

    const first = await repository.findOne(
      createOrganizationId(oid('org-1')),
      createUserId(oid('user-1')),
      createAlertType('CASE_ASSIGNED'),
      createNotificationChannel('SLACK'),
    );
    expect(first?.enabled).toBe(false);
    const second = await repository.findOne(
      createOrganizationId(oid('org-1')),
      createUserId(oid('user-1')),
      createAlertType('CRITICAL_RISK'),
      createNotificationChannel('WEBHOOK'),
    );
    expect(second?.enabled).toBe(true);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ alertType: 'CASE_ASSIGNED', channel: 'SLACK', enabled: false }),
        expect.objectContaining({ alertType: 'CRITICAL_RISK', channel: 'WEBHOOK', enabled: true }),
      ]),
    );
  });

  it('rejects the WHOLE batch when one entry has channel IN_APP — zero writes, zero audits', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const upsertSpy = jest.spyOn(repository, 'upsert');
    const { setPreferences, unitOfWork, auditRecorder } = buildUseCase(repository);

    await expect(
      setPreferences({
        auth: ORG_1_USER,
        entries: [
          { alertType: 'CASE_ASSIGNED', channel: 'EMAIL', enabled: true },
          { alertType: 'CRITICAL_RISK', channel: 'IN_APP', enabled: true },
        ],
      }),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_CHANNEL_NOT_CONFIGURABLE' });

    expect(upsertSpy).not.toHaveBeenCalled();
    expect(auditRecorder.all()).toHaveLength(0);
    expect(unitOfWork.transactionCount).toBe(0);
  });

  it('rejects the WHOLE batch when one entry has an unknown alertType — zero writes, zero audits', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const upsertSpy = jest.spyOn(repository, 'upsert');
    const { setPreferences, auditRecorder } = buildUseCase(repository);

    await expect(
      setPreferences({
        auth: ORG_1_USER,
        entries: [
          { alertType: 'CASE_ASSIGNED', channel: 'EMAIL', enabled: true },
          { alertType: 'BOGUS_TYPE', channel: 'EMAIL', enabled: true },
        ],
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ALERT_TYPE' });

    expect(upsertSpy).not.toHaveBeenCalled();
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('rejects the WHOLE batch when one entry has an unknown channel — zero writes, zero audits', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const upsertSpy = jest.spyOn(repository, 'upsert');
    const { setPreferences, auditRecorder } = buildUseCase(repository);

    await expect(
      setPreferences({
        auth: ORG_1_USER,
        entries: [
          { alertType: 'CASE_ASSIGNED', channel: 'EMAIL', enabled: true },
          { alertType: 'CRITICAL_RISK', channel: 'SMS', enabled: true },
        ],
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_CHANNEL' });

    expect(upsertSpy).not.toHaveBeenCalled();
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('rejects an empty entries array before opening a transaction', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const { setPreferences, unitOfWork } = buildUseCase(repository);

    await expect(setPreferences({ auth: ORG_1_USER, entries: [] })).rejects.toThrow();
    expect(unitOfWork.transactionCount).toBe(0);
  });

  it('scopes every write to the caller — never another user or organization', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const { setPreferences } = buildUseCase(repository);

    await setPreferences({
      auth: ORG_1_USER,
      entries: [{ alertType: 'CASE_ASSIGNED', channel: 'EMAIL', enabled: false }],
    });

    const otherUser = await repository.findOne(
      createOrganizationId(oid('org-1')),
      createUserId(oid('user-2')),
      createAlertType('CASE_ASSIGNED'),
      createNotificationChannel('EMAIL'),
    );
    expect(otherUser).toBeNull();
    const otherOrg = await repository.findOne(
      createOrganizationId(oid('org-2')),
      createUserId(oid('user-1')),
      createAlertType('CASE_ASSIGNED'),
      createNotificationChannel('EMAIL'),
    );
    expect(otherOrg).toBeNull();
  });
});

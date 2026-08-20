import { oid } from '../../../support/oid.js';
import { createSetNotificationPreferenceUseCase } from '../../../../src/modules/notifications/application/SetNotificationPreference.js';
import { InMemoryNotificationPreferenceRepository } from '../../../helpers/notifications/InMemoryNotificationPreferenceRepository.js';
import { InMemoryUnitOfWork } from '../../../helpers/notifications/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/notifications/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { NotificationPreference } from '../../../../src/modules/notifications/domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { createAlertType } from '../../../../src/modules/notifications/domain/model/value-objects/AlertType.js';
import { createNotificationChannel } from '../../../../src/modules/notifications/domain/model/value-objects/NotificationChannel.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { NotificationsError } from '../../../../src/modules/notifications/domain/errors/NotificationsError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const UPDATED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_1_USER = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1') });

function buildUseCase(repository: InMemoryNotificationPreferenceRepository, now = UPDATED_AT) {
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const setPreference = createSetNotificationPreferenceUseCase({
    repository,
    unitOfWork,
    clock: new FixedClock(now),
    auditRecorder,
  });
  return { setPreference, unitOfWork, auditRecorder };
}

describe('createSetNotificationPreferenceUseCase', () => {
  it('upserts a new row with the desired state when none existed', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const { setPreference } = buildUseCase(repository);

    const result = await setPreference({
      auth: ORG_1_USER,
      alertType: 'RIESGO_CRITICO',
      channel: 'EMAIL',
      enabled: false,
    });

    expect(result.enabled).toBe(false);
    expect(result.updatedAt).toBe(UPDATED_AT);
    const stored = await repository.findOne(
      createOrganizationId(oid('org-1')),
      createUserId(oid('user-1')),
      createAlertType('RIESGO_CRITICO'),
      createNotificationChannel('EMAIL'),
    );
    expect(stored?.enabled).toBe(false);
  });

  it('emits exactly one NOTIFICATION_PREFERENCE_UPDATED audit event inside the same transaction', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const { setPreference, auditRecorder } = buildUseCase(repository);

    await setPreference({ auth: ORG_1_USER, alertType: 'RIESGO_CRITICO', channel: 'EMAIL', enabled: false });

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeDefined();
    expect(calls[0].event.action).toBe('NOTIFICATION_PREFERENCE_UPDATED');
    expect(calls[0].event.resource).toBe('notificationPreferences');
    expect(calls[0].event.resourceId).toBe('RIESGO_CRITICO:EMAIL');
  });

  it('reactivates a previously deactivated alert type, advancing updatedAt', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    repository.seed(
      NotificationPreference.create({
        organizationId: createOrganizationId(oid('org-1')),
        userId: createUserId(oid('user-1')),
        alertType: createAlertType('SLA_POR_VENCER'),
        channel: createNotificationChannel('EMAIL'),
        enabled: false,
        now: CREATED_AT,
      }),
    );
    const { setPreference } = buildUseCase(repository);

    const result = await setPreference({
      auth: ORG_1_USER,
      alertType: 'SLA_POR_VENCER',
      channel: 'EMAIL',
      enabled: true,
    });

    expect(result.enabled).toBe(true);
    expect(result.updatedAt).toBe(UPDATED_AT);
  });

  it('is idempotent on a repeat toggle: enabled stays false but updatedAt and audit still advance', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    repository.seed(
      NotificationPreference.create({
        organizationId: createOrganizationId(oid('org-1')),
        userId: createUserId(oid('user-1')),
        alertType: createAlertType('SLA_POR_VENCER'),
        channel: createNotificationChannel('EMAIL'),
        enabled: false,
        now: CREATED_AT,
      }),
    );
    const { setPreference, auditRecorder } = buildUseCase(repository);

    const result = await setPreference({
      auth: ORG_1_USER,
      alertType: 'SLA_POR_VENCER',
      channel: 'EMAIL',
      enabled: false,
    });

    expect(result.enabled).toBe(false);
    expect(result.updatedAt).toBe(UPDATED_AT);
    expect(auditRecorder.all()).toHaveLength(1);
  });

  it('rejects when the audit recorder fails inside withTransaction, without a partial commit signal', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const { setPreference, auditRecorder } = buildUseCase(repository);
    auditRecorder.forceFailure(new Error('audit backend unavailable'));

    await expect(
      setPreference({ auth: ORG_1_USER, alertType: 'RIESGO_CRITICO', channel: 'EMAIL', enabled: false }),
    ).rejects.toThrow('audit backend unavailable');
  });

  it('rejects a null organizationId with FORBIDDEN_CROSS_TENANT before any repository/audit call', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const upsertSpy = jest.spyOn(repository, 'upsert');
    const { setPreference, auditRecorder } = buildUseCase(repository);
    const platformAdmin = createAuthContext({ userId: oid('admin-1'), organizationId: null, isPlatformAdmin: true });

    expect.assertions(4);
    try {
      await setPreference({ auth: platformAdmin, alertType: 'RIESGO_CRITICO', channel: 'EMAIL', enabled: false });
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationsError);
      expect((error as InstanceType<typeof NotificationsError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('ignores a spoofed userId field in the request, using only auth.userId', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const { setPreference } = buildUseCase(repository);

    await setPreference({
      auth: ORG_1_USER,
      alertType: 'RIESGO_CRITICO',
      channel: 'EMAIL',
      enabled: false,
      // @ts-expect-error — userId is not part of the input contract; verifying it is ignored if present
      userId: oid('user-2'),
    });

    const spoofed = await repository.findOne(
      createOrganizationId(oid('org-1')),
      createUserId(oid('user-2')),
      createAlertType('RIESGO_CRITICO'),
      createNotificationChannel('EMAIL'),
    );
    expect(spoofed).toBeNull();
    const real = await repository.findOne(
      createOrganizationId(oid('org-1')),
      createUserId(oid('user-1')),
      createAlertType('RIESGO_CRITICO'),
      createNotificationChannel('EMAIL'),
    );
    expect(real?.enabled).toBe(false);
  });

  it('rejects an unknown alertType before any repository/audit call', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const upsertSpy = jest.spyOn(repository, 'upsert');
    const { setPreference, auditRecorder } = buildUseCase(repository);

    await expect(
      setPreference({ auth: ORG_1_USER, alertType: 'not_a_real_type', channel: 'EMAIL', enabled: false }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ALERT_TYPE' });
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('rejects an unknown channel before any repository/audit call', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const upsertSpy = jest.spyOn(repository, 'upsert');
    const { setPreference, auditRecorder } = buildUseCase(repository);

    await expect(
      setPreference({ auth: ORG_1_USER, alertType: 'RIESGO_CRITICO', channel: 'SMS', enabled: false }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_CHANNEL' });
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(auditRecorder.all()).toHaveLength(0);
  });
});

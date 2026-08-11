import { createGetNotificationPreferencesUseCase } from '../../../../src/modules/notifications/application/GetNotificationPreferences.js';
import { InMemoryNotificationPreferenceRepository } from '../../../helpers/notifications/InMemoryNotificationPreferenceRepository.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { NotificationPreference } from '../../../../src/modules/notifications/domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { createAlertType } from '../../../../src/modules/notifications/domain/model/value-objects/AlertType.js';
import { createNotificationChannel } from '../../../../src/modules/notifications/domain/model/value-objects/NotificationChannel.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { NotificationsError } from '../../../../src/modules/notifications/domain/errors/NotificationsError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1_USER = createAuthContext({ userId: 'user-1', organizationId: 'org-1' });

function buildUseCase(repository: InMemoryNotificationPreferenceRepository) {
  return createGetNotificationPreferencesUseCase({ repository });
}

describe('createGetNotificationPreferencesUseCase', () => {
  it('returns all 4 alert types enabled:true (default-ON) when no rows exist', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const getPreferences = buildUseCase(repository);

    const matrix = await getPreferences({ auth: ORG_1_USER });

    expect(matrix).toEqual([
      { alertType: 'CASO_ASIGNADO', channel: 'EMAIL', enabled: true },
      { alertType: 'SLA_POR_VENCER', channel: 'EMAIL', enabled: true },
      { alertType: 'APROBACION_PENDIENTE', channel: 'EMAIL', enabled: true },
      { alertType: 'RIESGO_CRITICO', channel: 'EMAIL', enabled: true },
    ]);
  });

  it('overlays a stored row onto the default matrix, leaving the other 3 true', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    repository.seed(
      NotificationPreference.create({
        organizationId: createOrganizationId('org-1'),
        userId: createUserId('user-1'),
        alertType: createAlertType('SLA_POR_VENCER'),
        channel: createNotificationChannel('EMAIL'),
        enabled: false,
        now: NOW,
      }),
    );
    const getPreferences = buildUseCase(repository);

    const matrix = await getPreferences({ auth: ORG_1_USER });

    const slaEntry = matrix.find((entry) => entry.alertType === 'SLA_POR_VENCER');
    expect(slaEntry?.enabled).toBe(false);
    const others = matrix.filter((entry) => entry.alertType !== 'SLA_POR_VENCER');
    expect(others.every((entry) => entry.enabled === true)).toBe(true);
  });

  it('rejects a null organizationId with FORBIDDEN_CROSS_TENANT, without calling the repository', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const findByUserSpy = jest.spyOn(repository, 'findByUser');
    const getPreferences = buildUseCase(repository);
    const platformAdmin = createAuthContext({ userId: 'admin-1', organizationId: null, isPlatformAdmin: true });

    expect.assertions(3);
    try {
      await getPreferences({ auth: platformAdmin });
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationsError);
      expect((error as InstanceType<typeof NotificationsError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(findByUserSpy).not.toHaveBeenCalled();
  });

  it('only ever passes the caller\'s own userId to the repository', async () => {
    const repository = new InMemoryNotificationPreferenceRepository();
    const findByUserSpy = jest.spyOn(repository, 'findByUser');
    const getPreferences = buildUseCase(repository);

    await getPreferences({ auth: ORG_1_USER });

    expect(findByUserSpy).toHaveBeenCalledWith('org-1', 'user-1');
  });
});

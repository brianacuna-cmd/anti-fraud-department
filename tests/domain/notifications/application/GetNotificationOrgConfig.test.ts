import { oid } from '../../../support/oid.js';
import { createGetNotificationOrgConfigUseCase } from '../../../../src/modules/notifications/application/GetNotificationOrgConfig.js';
import { InMemoryNotificationOrgConfigRepository } from '../../../helpers/notifications/InMemoryNotificationOrgConfigRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { NotificationOrgConfig } from '../../../../src/modules/notifications/domain/model/aggregates/NotificationOrgConfig.js';
import { createNotificationOrgConfigId } from '../../../../src/modules/notifications/domain/model/value-objects/NotificationOrgConfigId.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const AUTH = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1'), roleId: 'SUPERVISOR' });

describe('createGetNotificationOrgConfigUseCase', () => {
  it('returns a default empty config (webhookUrl: null) when none exists — never throws', async () => {
    const repository = new InMemoryNotificationOrgConfigRepository();
    const getConfig = createGetNotificationOrgConfigUseCase({ repository, clock: new FixedClock(NOW) });

    const config = await getConfig({ auth: AUTH });

    expect(config.webhookUrl).toBeNull();
  });

  it('returns the stored config when present', async () => {
    const repository = new InMemoryNotificationOrgConfigRepository();
    repository.seed(
      NotificationOrgConfig.create({
        id: createNotificationOrgConfigId(oid('config-1')),
        organizationId: createOrganizationId(oid('org-1')),
        webhookUrl: 'https://hooks.example.com/x',
        now: NOW,
      }),
    );
    const getConfig = createGetNotificationOrgConfigUseCase({ repository, clock: new FixedClock(NOW) });

    const config = await getConfig({ auth: AUTH });

    expect(config.webhookUrl).toBe('https://hooks.example.com/x');
  });

  it('enforces requireTenantContext (platform-admin has no org context)', async () => {
    const repository = new InMemoryNotificationOrgConfigRepository();
    const getConfig = createGetNotificationOrgConfigUseCase({ repository, clock: new FixedClock(NOW) });
    const platformAdminAuth = createAuthContext({
      userId: oid('admin-1'),
      organizationId: null,
      isPlatformAdmin: true,
      roleId: 'SUPERVISOR',
    });

    await expect(getConfig({ auth: platformAdminAuth })).rejects.toThrow();
  });

  it('rejects a caller whose role is not in SUPERVISION_ROLES', async () => {
    const repository = new InMemoryNotificationOrgConfigRepository();
    const getConfig = createGetNotificationOrgConfigUseCase({ repository, clock: new FixedClock(NOW) });
    const analystAuth = createAuthContext({ userId: oid('user-2'), organizationId: oid('org-1'), roleId: 'ANALYST' });

    await expect(getConfig({ auth: analystAuth })).rejects.toThrow();
  });
});

import { oid } from '../../../support/oid.js';
import { createGetOrganizationFraudConfigUseCase } from '../../../../src/modules/case-management/application/GetOrganizationFraudConfig.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1_USER = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1') });

function buildUseCase(repository: InMemoryOrganizationFraudConfigRepository) {
  return createGetOrganizationFraudConfigUseCase({ repository });
}

describe('createGetOrganizationFraudConfigUseCase', () => {
  it('returns the config for the caller organization', async () => {
    const repository = new InMemoryOrganizationFraudConfigRepository();
    repository.seed(
      OrganizationFraudConfig.create({
        id: createOrganizationFraudConfigId(oid('config-1')),
        organizationId: oid('org-1'),
        slaLowMinutes: 240,
        slaMediumMinutes: 120,
        slaHighMinutes: 60,
        slaCriticalMinutes: 30,
        riskThresholdLow: 25,
        riskThresholdMedium: 50,
        riskThresholdHigh: 75,
        riskThresholdCritical: 90,
        featureFlags: {},
        now: NOW,
      }),
    );
    const getConfig = buildUseCase(repository);

    const result = await getConfig({ auth: ORG_1_USER });

    expect(result.organizationId).toBe(oid('org-1'));
    expect(result.slaHighMinutes).toBe(60);
  });

  it('throws ORGANIZATION_FRAUD_CONFIG_NOT_FOUND when no config exists for the org', async () => {
    const repository = new InMemoryOrganizationFraudConfigRepository();
    const getConfig = buildUseCase(repository);

    expect.assertions(2);
    try {
      await getConfig({ auth: ORG_1_USER });
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('ORGANIZATION_FRAUD_CONFIG_NOT_FOUND');
    }
  });

  it('rejects a null organizationId with FORBIDDEN_CROSS_TENANT before any repository call', async () => {
    const repository = new InMemoryOrganizationFraudConfigRepository();
    const findSpy = jest.spyOn(repository, 'findByOrganization');
    const getConfig = buildUseCase(repository);
    const platformAdmin = createAuthContext({ userId: oid('admin-1'), organizationId: null, isPlatformAdmin: true });

    expect.assertions(3);
    try {
      await getConfig({ auth: platformAdmin });
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(findSpy).not.toHaveBeenCalled();
  });
});

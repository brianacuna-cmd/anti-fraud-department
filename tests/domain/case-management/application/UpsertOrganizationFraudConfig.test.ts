import { oid } from '../../../support/oid.js';
import { createUpsertOrganizationFraudConfigUseCase } from '../../../../src/modules/case-management/application/UpsertOrganizationFraudConfig.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const NOW = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_1_USER = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1') });

const VALID_INPUT = {
  slaLowMinutes: 240,
  slaMediumMinutes: 120,
  slaHighMinutes: 60,
  slaCriticalMinutes: 30,
  riskThresholdLow: 25,
  riskThresholdMedium: 50,
  riskThresholdHigh: 75,
  riskThresholdCritical: 90,
  featureFlags: {},
};

function buildUseCase(repository: InMemoryOrganizationFraudConfigRepository, now = NOW) {
  return createUpsertOrganizationFraudConfigUseCase({ repository, clock: new FixedClock(now) });
}

describe('createUpsertOrganizationFraudConfigUseCase', () => {
  it('creates a new config when none existed for the org', async () => {
    const repository = new InMemoryOrganizationFraudConfigRepository();
    const upsertConfig = buildUseCase(repository);

    const result = await upsertConfig({ auth: ORG_1_USER, ...VALID_INPUT });

    expect(result.organizationId).toBe(oid('org-1'));
    expect(result.slaCriticalMinutes).toBe(30);
    expect(result.createdAt).toBe(NOW);
    expect(result.updatedAt).toBe(NOW);
    const stored = await repository.findByOrganization(oid('org-1'));
    expect(stored?.riskThresholdCritical).toBe(90);
  });

  it('is idempotent: re-upserting the same org updates the existing singleton, not a second document', async () => {
    const repository = new InMemoryOrganizationFraudConfigRepository();
    repository.seed(
      OrganizationFraudConfig.create({
        id: createOrganizationFraudConfigId(oid('config-1')),
        organizationId: oid('org-1'),
        ...VALID_INPUT,
        now: CREATED_AT,
      }),
    );
    const upsertConfig = buildUseCase(repository);

    const result = await upsertConfig({ auth: ORG_1_USER, ...VALID_INPUT, slaCriticalMinutes: 15 });

    expect(result.id).toBe(createOrganizationFraudConfigId(oid('config-1')));
    expect(result.slaCriticalMinutes).toBe(15);
    expect(result.createdAt).toBe(CREATED_AT);
    expect(result.updatedAt).toBe(NOW);
  });

  it('rejects a null organizationId with FORBIDDEN_CROSS_TENANT before any repository call', async () => {
    const repository = new InMemoryOrganizationFraudConfigRepository();
    const upsertSpy = jest.spyOn(repository, 'upsert');
    const upsertConfig = buildUseCase(repository);
    const platformAdmin = createAuthContext({ userId: oid('admin-1'), organizationId: null, isPlatformAdmin: true });

    expect.assertions(3);
    try {
      await upsertConfig({ auth: platformAdmin, ...VALID_INPUT });
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('rejects negative SLA minutes before persisting', async () => {
    const repository = new InMemoryOrganizationFraudConfigRepository();
    const upsertConfig = buildUseCase(repository);

    await expect(
      upsertConfig({ auth: ORG_1_USER, ...VALID_INPUT, slaLowMinutes: -1 }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
  });
});

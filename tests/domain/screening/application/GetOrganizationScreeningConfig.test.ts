import { createGetOrganizationScreeningConfigUseCase } from '../../../../src/modules/screening/application/GetOrganizationScreeningConfig.js';
import type { OrganizationScreeningConfigRepository } from '../../../../src/modules/screening/domain/ports/OrganizationScreeningConfigRepository.js';
import { OrganizationScreeningConfig } from '../../../../src/modules/screening/domain/model/aggregates/OrganizationScreeningConfig.js';
import { createOrganizationScreeningConfigId } from '../../../../src/modules/screening/domain/model/value-objects/OrganizationScreeningConfigId.js';
import { DEFAULT_CONFIANZA_THRESHOLDS } from '../../../../src/modules/screening/domain/services/ConfianzaTiering.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const ORG = 'org-1';
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function tenantAuth(organizationId: string | null = ORG) {
  return createAuthContext({
    userId: 'user-1',
    organizationId,
    actorType: organizationId === null ? 'PLATFORM_ADMIN' : 'USER',
    ipAddress: '10.0.0.1',
  });
}

class StubRepository implements OrganizationScreeningConfigRepository {
  constructor(private readonly config: OrganizationScreeningConfig | null) {}

  async upsert(): Promise<void> {
    // not exercised
  }

  async findByOrganization(): Promise<OrganizationScreeningConfig | null> {
    return this.config;
  }
}

describe('createGetOrganizationScreeningConfigUseCase', () => {
  it('returns the persisted thresholds when a config row exists', async () => {
    const config = OrganizationScreeningConfig.create({
      id: createOrganizationScreeningConfigId('507f1f77bcf86cd799439011'),
      organizationId: ORG,
      alertThreshold: 40,
      signalThreshold: 80,
      now: NOW,
    });
    const getConfig = createGetOrganizationScreeningConfigUseCase({ repository: new StubRepository(config) });

    const result = await getConfig({ auth: tenantAuth() });

    expect(result).toEqual({ alertThreshold: 40, signalThreshold: 80 });
  });

  it('returns DEFAULT_CONFIANZA_THRESHOLDS (50/70) when no row exists, WITHOUT throwing', async () => {
    const getConfig = createGetOrganizationScreeningConfigUseCase({ repository: new StubRepository(null) });

    const result = await getConfig({ auth: tenantAuth() });

    expect(result).toEqual(DEFAULT_CONFIANZA_THRESHOLDS);
  });

  it('rejects a missing tenant context before querying the repository', async () => {
    const getConfig = createGetOrganizationScreeningConfigUseCase({ repository: new StubRepository(null) });

    await expect(getConfig({ auth: tenantAuth(null) })).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});

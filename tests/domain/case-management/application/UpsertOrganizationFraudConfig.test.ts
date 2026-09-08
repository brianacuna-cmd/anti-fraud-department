import { oid } from '../../../support/oid.js';
import { createUpsertOrganizationFraudConfigUseCase } from '../../../../src/modules/case-management/application/UpsertOrganizationFraudConfig.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryUnitOfWork, ThrowingUnitOfWork } from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/case-management/domain/ports/AuditRecorder.js';
import type { Transaction, UnitOfWork } from '../../../../src/modules/case-management/domain/ports/UnitOfWork.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const NOW = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_1_USER = createAuthContext({
  userId: oid('user-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
  roleId: 'SUPERVISOR',
  ipAddress: '10.0.0.1',
});

const SECRET = 'whsec_do-not-leak-this-secret-value!!';
const WEBHOOK_URL = 'https://hooks.example.com/fraud';

const VALID_INPUT = {
  slaLowMinutes: 240,
  slaMediumMinutes: 120,
  slaHighMinutes: 60,
  slaCriticalMinutes: 30,
  riskThresholdLow: 25,
  riskThresholdMedium: 50,
  riskThresholdHigh: 75,
  riskThresholdCritical: 90,
  featureFlags: { autoRouting: true },
};

function expectedAuditDetail(overrides: {
  readonly outboundWebhookUrlSet?: boolean;
  readonly outboundWebhookSecretSet?: boolean;
  readonly slaCriticalMinutes?: number;
} = {}) {
  return {
    slaLowMinutes: VALID_INPUT.slaLowMinutes,
    slaMediumMinutes: VALID_INPUT.slaMediumMinutes,
    slaHighMinutes: VALID_INPUT.slaHighMinutes,
    slaCriticalMinutes: overrides.slaCriticalMinutes ?? VALID_INPUT.slaCriticalMinutes,
    riskThresholdLow: VALID_INPUT.riskThresholdLow,
    riskThresholdMedium: VALID_INPUT.riskThresholdMedium,
    riskThresholdHigh: VALID_INPUT.riskThresholdHigh,
    riskThresholdCritical: VALID_INPUT.riskThresholdCritical,
    featureFlags: VALID_INPUT.featureFlags,
    outboundWebhookUrlSet: overrides.outboundWebhookUrlSet ?? false,
    outboundWebhookSecretSet: overrides.outboundWebhookSecretSet ?? false,
  };
}

function buildUseCase(
  overrides: {
    readonly repository?: InMemoryOrganizationFraudConfigRepository;
    readonly auditRecorder?: AuditRecorder;
    readonly unitOfWork?: UnitOfWork;
    readonly now?: typeof NOW;
  } = {},
) {
  const repository = overrides.repository ?? new InMemoryOrganizationFraudConfigRepository();
  const auditRecorder = overrides.auditRecorder ?? new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = overrides.unitOfWork ?? new InMemoryUnitOfWork();
  const upsertConfig = createUpsertOrganizationFraudConfigUseCase({
    repository,
    clock: new FixedClock(overrides.now ?? NOW),
    auditRecorder,
    unitOfWork,
  });
  return { repository, auditRecorder, unitOfWork, upsertConfig };
}

describe('createUpsertOrganizationFraudConfigUseCase', () => {
  it('creates a new config when none existed for the org', async () => {
    const { repository, upsertConfig } = buildUseCase();

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
    const { upsertConfig } = buildUseCase({ repository });

    const result = await upsertConfig({ auth: ORG_1_USER, ...VALID_INPUT, slaCriticalMinutes: 15 });

    expect(result.id).toBe(createOrganizationFraudConfigId(oid('config-1')));
    expect(result.slaCriticalMinutes).toBe(15);
    expect(result.createdAt).toBe(CREATED_AT);
    expect(result.updatedAt).toBe(NOW);
  });

  it('rejects a platform admin, which has no tenant to configure, before any repository call', async () => {
    const repository = new InMemoryOrganizationFraudConfigRepository();
    const upsertSpy = jest.spyOn(repository, 'upsert');
    const { upsertConfig, auditRecorder } = buildUseCase({ repository });
    const platformAdmin = createAuthContext({ userId: oid('admin-1'), organizationId: null, isPlatformAdmin: true });

    expect.assertions(4);
    try {
      await upsertConfig({ auth: platformAdmin, ...VALID_INPUT });
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
    expect(upsertSpy).not.toHaveBeenCalled();
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toHaveLength(0);
  });

  /**
   * Risk thresholds and SLA deadlines decide what is pursued and in how much
   * time: that is operational policy. Whoever administers the team reads it,
   * does not rewrite it (SoD, see `shared/kernel/AccessTier.ts`).
   */
  it.each([
    ['ADMIN', () => createAuthContext({ userId: oid('admin-1'), organizationId: oid('org-1'), actorType: 'USER', roleId: 'ADMIN' })],
    ['the ORGANIZATION actor', () => createAuthContext({ userId: oid('org-1'), organizationId: oid('org-1'), actorType: 'ORGANIZATION' })],
  ])('rejects %s as read-only before any repository call', async (_label, actor) => {
    const repository = new InMemoryOrganizationFraudConfigRepository();
    const upsertSpy = jest.spyOn(repository, 'upsert');
    const { upsertConfig, auditRecorder } = buildUseCase({ repository });

    await expect(upsertConfig({ auth: actor(), ...VALID_INPUT })).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
      metadata: expect.objectContaining({ readOnly: true }),
    });
    expect(upsertSpy).not.toHaveBeenCalled();
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toHaveLength(0);
  });

  it('rejects negative SLA minutes before persisting', async () => {
    const { repository, upsertConfig, auditRecorder } = buildUseCase();

    await expect(
      upsertConfig({ auth: ORG_1_USER, ...VALID_INPUT, slaLowMinutes: -1 }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
    expect(await repository.findByOrganization(oid('org-1'))).toBeNull();
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toHaveLength(0);
  });

  it('emits UPSERT_ORGANIZATION_FRAUD_CONFIG with config id and policy detail on create', async () => {
    const { upsertConfig, auditRecorder, unitOfWork } = buildUseCase();

    const created = await upsertConfig({ auth: ORG_1_USER, ...VALID_INPUT });

    expect((unitOfWork as InMemoryUnitOfWork).transactionCount).toBe(1);
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toEqual([
      expect.objectContaining({
        action: 'UPSERT_ORGANIZATION_FRAUD_CONFIG',
        resource: 'organization_fraud_config',
        resourceId: String(created.id),
        organizationId: oid('org-1'),
        actorType: 'USER',
        actorId: oid('user-1'),
        ipAddress: '10.0.0.1',
        detail: expectedAuditDetail(),
      }),
    ]);
  });

  it('re-upsert emits the same action/resource with the existing config id', async () => {
    const repository = new InMemoryOrganizationFraudConfigRepository();
    repository.seed(
      OrganizationFraudConfig.create({
        id: createOrganizationFraudConfigId(oid('config-1')),
        organizationId: oid('org-1'),
        ...VALID_INPUT,
        now: CREATED_AT,
      }),
    );
    const { upsertConfig, auditRecorder } = buildUseCase({ repository });

    const updated = await upsertConfig({ auth: ORG_1_USER, ...VALID_INPUT, slaCriticalMinutes: 15 });

    expect(updated.id).toBe(createOrganizationFraudConfigId(oid('config-1')));
    const events = (auditRecorder as InMemoryCaseManagementAuditRecorder).all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'UPSERT_ORGANIZATION_FRAUD_CONFIG',
      resource: 'organization_fraud_config',
      resourceId: String(createOrganizationFraudConfigId(oid('config-1'))),
      detail: expectedAuditDetail({ slaCriticalMinutes: 15 }),
    });
  });

  it('records URL and secret presence without the secret key or value', async () => {
    const { upsertConfig, auditRecorder } = buildUseCase();

    await upsertConfig({
      auth: ORG_1_USER,
      ...VALID_INPUT,
      outboundWebhookUrl: WEBHOOK_URL,
      outboundWebhookSecret: SECRET,
    });

    const [event] = (auditRecorder as InMemoryCaseManagementAuditRecorder).all();
    expect(event.detail).toEqual(
      expectedAuditDetail({ outboundWebhookUrlSet: true, outboundWebhookSecretSet: true }),
    );
    expect('outboundWebhookSecret' in event.detail).toBe(false);
    expect('outboundWebhookUrl' in event.detail).toBe(false);
    expect(JSON.stringify(event.detail)).not.toContain(SECRET);
    expect(JSON.stringify(event.detail)).not.toContain(WEBHOOK_URL);
  });

  it('threads the same transaction handle into find, upsert, and record', async () => {
    const repository = new InMemoryOrganizationFraudConfigRepository();
    const seenTx: Array<Transaction | undefined> = [];
    const originalFind = repository.findByOrganization.bind(repository);
    repository.findByOrganization = async (organizationId, tx) => {
      seenTx.push(tx);
      return originalFind(organizationId, tx);
    };
    const originalUpsert = repository.upsert.bind(repository);
    repository.upsert = async (config, tx) => {
      seenTx.push(tx);
      return originalUpsert(config, tx);
    };
    const auditRecorder: AuditRecorder = {
      record: async (event: AuditEvent, tx?: Transaction) => {
        seenTx.push(tx);
        void event;
      },
    };
    const { upsertConfig } = buildUseCase({ repository, auditRecorder });

    await upsertConfig({ auth: ORG_1_USER, ...VALID_INPUT });

    expect(seenTx).toHaveLength(3);
    expect(seenTx[0]).toBeDefined();
    expect(seenTx[0]).toBe(seenTx[1]);
    expect(seenTx[1]).toBe(seenTx[2]);
  });

  it('commits neither config nor audit when the transaction aborts', async () => {
    const { repository, upsertConfig, auditRecorder } = buildUseCase({
      unitOfWork: new ThrowingUnitOfWork(),
    });

    await expect(upsertConfig({ auth: ORG_1_USER, ...VALID_INPUT })).rejects.toThrow(
      'simulated transaction abort',
    );
    expect(await repository.findByOrganization(oid('org-1'))).toBeNull();
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toHaveLength(0);
  });
});

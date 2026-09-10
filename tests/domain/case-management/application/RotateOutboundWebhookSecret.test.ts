import { oid } from '../../../support/oid.js';
import { createRotateOutboundWebhookSecretUseCase } from '../../../../src/modules/case-management/application/RotateOutboundWebhookSecret.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryUnitOfWork } from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const S0 = 's0-current-secret-value-32chars-min!!';
const S1 = 's1-rotated-secret-value-32chars-min!!';

const SUPERVISOR = createAuthContext({
  userId: oid('user-1'),
  organizationId: oid('org-1'),
  roleId: 'SUPERVISOR',
  ipAddress: '10.0.0.1',
});

function seedConfig(secret: string | null = S0) {
  return OrganizationFraudConfig.create({
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
    outboundWebhookSecret: secret,
    now: NOW,
  });
}

function build() {
  const repository = new InMemoryOrganizationFraudConfigRepository();
  repository.seed(seedConfig());
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const rotate = createRotateOutboundWebhookSecretUseCase({
    repository,
    clock: new FixedClock(NOW),
    auditRecorder,
    unitOfWork: new InMemoryUnitOfWork(),
    generateSecret: () => S1,
  });
  return { repository, auditRecorder, rotate };
}

describe('createRotateOutboundWebhookSecretUseCase', () => {
  it('copies current to previous, mints current, and starts 24h grace by default', async () => {
    const { rotate, repository } = build();

    const result = await rotate({ auth: SUPERVISOR });

    expect(result.outboundWebhookPreviousSecret).toBe(S0);
    expect(result.outboundWebhookSecret).toBe(S1);
    expect(result.outboundWebhookSecretGraceExpiresAt).toBe(fromDate(new Date('2026-01-02T00:00:00.000Z')));
    expect((await repository.findByOrganization(oid('org-1')))?.outboundWebhookSecret).toBe(S1);
  });

  it('honors gracePeriodHours 48', async () => {
    const { rotate } = build();

    const result = await rotate({ auth: SUPERVISOR, gracePeriodHours: 48 });

    expect(result.outboundWebhookSecretGraceExpiresAt).toBe(fromDate(new Date('2026-01-03T00:00:00.000Z')));
  });

  it('rejects gracePeriodHours 0 and 169', async () => {
    const { rotate } = build();

    await expect(rotate({ auth: SUPERVISOR, gracePeriodHours: 0 })).rejects.toMatchObject({
      code: 'INVARIANT_VIOLATION',
    });
    await expect(rotate({ auth: SUPERVISOR, gracePeriodHours: 169 })).rejects.toMatchObject({
      code: 'INVARIANT_VIOLATION',
    });
  });

  it('audits ROTATE_WEBHOOK_SECRET without secret bytes', async () => {
    const { rotate, auditRecorder } = build();

    await rotate({ auth: SUPERVISOR });

    const [event] = auditRecorder.all();
    expect(event.action).toBe('ROTATE_WEBHOOK_SECRET');
    expect(JSON.stringify(event)).not.toContain(S0);
    expect(JSON.stringify(event)).not.toContain(S1);
    expect(event.detail).toEqual({
      gracePeriodHours: 24,
      graceExpiresAt: fromDate(new Date('2026-01-02T00:00:00.000Z')),
    });
  });

  it('rejects ANALYST', async () => {
    const { rotate } = build();
    await expect(
      rotate({
        auth: createAuthContext({
          userId: oid('user-1'),
          organizationId: oid('org-1'),
          roleId: 'ANALYST',
        }),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });
});

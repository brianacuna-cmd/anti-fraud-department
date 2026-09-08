import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createTestOutgoingWebhookUseCase } from '../../../../src/modules/case-management/application/TestOutgoingWebhook.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { generateCustomerOutgoingEventId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryCustomerOutgoingEventRepository } from '../../../helpers/case-management/InMemoryCustomerOutgoingEventRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryUnitOfWork } from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import { FakeOutgoingWebhookClient } from '../../../helpers/case-management/FakeOutgoingWebhookClient.js';
import { FixedClock } from '../../../helpers/FixedClock.js';

const ORG_A = oid('org-a');
const ORG_B = oid('org-b');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const URL_A = 'https://hooks.example.com/a';
const URL_B = 'https://hooks.example.com/b';
const SECRET_A = 'tenant-a-hmac-secret';

function supervisor(organizationId = ORG_A) {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId,
    roleId: 'SUPERVISOR',
    ipAddress: '10.0.0.1',
  });
}

function fraudConfig(overrides: Partial<Parameters<typeof OrganizationFraudConfig.create>[0]> = {}) {
  return OrganizationFraudConfig.create({
    id: createOrganizationFraudConfigId(oid(`config-${overrides.organizationId ?? ORG_A}`)),
    organizationId: ORG_A,
    slaLowMinutes: 240,
    slaMediumMinutes: 120,
    slaHighMinutes: 60,
    slaCriticalMinutes: 30,
    riskThresholdLow: 25,
    riskThresholdMedium: 50,
    riskThresholdHigh: 75,
    riskThresholdCritical: 90,
    now: NOW,
    ...overrides,
  });
}

function buildUseCase(
  options: {
    readonly seedUrl?: string | null;
    readonly seedSecret?: string | null;
    readonly skipConfig?: boolean;
  } = {},
) {
  const fraudConfigs = new InMemoryOrganizationFraudConfigRepository();
  const outgoingEvents = new InMemoryCustomerOutgoingEventRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = new InMemoryUnitOfWork();
  const webhookClient = new FakeOutgoingWebhookClient();
  if (options.skipConfig !== true) {
    fraudConfigs.seed(
      fraudConfig({
        outboundWebhookUrl: options.seedUrl === undefined ? URL_A : options.seedUrl,
        outboundWebhookSecret: options.seedSecret === undefined ? SECRET_A : options.seedSecret,
      }),
    );
  }
  const execute = createTestOutgoingWebhookUseCase({
    fraudConfig: fraudConfigs,
    webhookClient,
    outgoingEvents,
    auditRecorder,
    unitOfWork,
    clock: new FixedClock(NOW),
    generateCustomerOutgoingEventId,
  });
  return { execute, fraudConfigs, outgoingEvents, auditRecorder, unitOfWork, webhookClient };
}

describe('createTestOutgoingWebhookUseCase', () => {
  it('throws OUTBOUND_WEBHOOK_URL_NOT_SET with no POST and no row when URL is unset', async () => {
    const { execute, outgoingEvents, webhookClient, unitOfWork } = buildUseCase({ seedUrl: null });

    await expect(execute({ auth: supervisor() })).rejects.toMatchObject({
      code: 'OUTBOUND_WEBHOOK_URL_NOT_SET',
    });
    expect(webhookClient.posts).toHaveLength(0);
    expect(outgoingEvents.all()).toHaveLength(0);
    expect(unitOfWork.transactionCount).toBe(0);
  });

  it('throws OUTBOUND_WEBHOOK_URL_NOT_SET when fraud-config is missing', async () => {
    const { execute, outgoingEvents, webhookClient } = buildUseCase({ skipConfig: true });

    await expect(execute({ auth: supervisor() })).rejects.toMatchObject({
      code: 'OUTBOUND_WEBHOOK_URL_NOT_SET',
    });
    expect(webhookClient.posts).toHaveLength(0);
    expect(outgoingEvents.all()).toHaveLength(0);
  });

  it('forwards the stored HMAC secret and posts WEBHOOK_TEST payload to the stored URL', async () => {
    const { execute, webhookClient, outgoingEvents } = buildUseCase();

    const result = await execute({ auth: supervisor() });

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(webhookClient.posts).toHaveLength(1);
    expect(webhookClient.posts[0]!.url).toBe(URL_A);
    expect(webhookClient.posts[0]!.secret).toBe(SECRET_A);
    expect(webhookClient.posts[0]!.payload).toEqual({
      event_type: 'WEBHOOK_TEST',
      organization_id: ORG_A,
      event_id: result.eventId,
      requested_at: NOW,
    });
    expect(webhookClient.posts[0]!.payload).not.toHaveProperty('enforcement_action_id');
    expect(webhookClient.posts[0]!.payload).not.toHaveProperty('action_type');
    expect(outgoingEvents.all()[0]!.status).toBe('SENT');
    expect(outgoingEvents.all()[0]!.attempts).toBe(1);
  });

  it('returns ok:false FAILED attempts=1 on remote 5xx and never writes PENDING', async () => {
    const { execute, outgoingEvents, webhookClient, auditRecorder } = buildUseCase();
    webhookClient.nextResult = { statusCode: 502, ok: false };

    const result = await execute({ auth: supervisor() });

    expect(result).toEqual({
      statusCode: 502,
      latencyMs: expect.any(Number),
      ok: false,
      eventId: result.eventId,
    });
    expect(Number.isInteger(result.latencyMs)).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const row = outgoingEvents.all()[0]!;
    expect(outgoingEvents.all()).toHaveLength(1);
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(1);
    expect(row.customerId).toBe('WEBHOOK_TEST');
    expect(row.enforcementActionId).toBeNull();
    expect(row.responseStatus).toBe(502);
    expect(row.status).not.toBe('PENDING');
    expect(auditRecorder.all()[0]).toMatchObject({
      action: 'WEBHOOK_TEST',
      resource: 'outgoing_webhook',
      resourceId: result.eventId,
      detail: { statusCode: 502, latencyMs: result.latencyMs, ok: false },
    });
    expect(JSON.stringify(auditRecorder.all()[0]!.detail)).not.toContain(SECRET_A);
    expect(JSON.stringify(auditRecorder.all()[0]!.detail)).not.toContain(URL_A);
  });

  it('persists FAILED with response_status 0 when post throws', async () => {
    const { execute, outgoingEvents, webhookClient } = buildUseCase();
    webhookClient.nextError = new Error('network timeout');

    const result = await execute({ auth: supervisor() });

    expect(result.statusCode).toBe(0);
    expect(result.ok).toBe(false);
    expect(outgoingEvents.all()[0]!.status).toBe('FAILED');
    expect(outgoingEvents.all()[0]!.responseStatus).toBe(0);
    expect(outgoingEvents.all()[0]!.status).not.toBe('PENDING');
  });

  it('posts only the caller tenant URL and does not touch another org outbox', async () => {
    const { execute, fraudConfigs, outgoingEvents, webhookClient } = buildUseCase();
    fraudConfigs.seed(
      fraudConfig({
        organizationId: ORG_B,
        outboundWebhookUrl: URL_B,
        outboundWebhookSecret: 'org-b-secret',
      }),
    );

    await execute({ auth: supervisor(ORG_A) });

    expect(webhookClient.posts.map((post) => post.url)).toEqual([URL_A]);
    expect(outgoingEvents.all().map((row) => row.organizationId)).toEqual([ORG_A]);
    expect(outgoingEvents.all().some((row) => row.organizationId === ORG_B)).toBe(false);
  });

  it('rejects ANALYST without posting or persisting', async () => {
    const { execute, outgoingEvents, webhookClient } = buildUseCase();

    try {
      await execute({
        auth: createAuthContext({
          userId: oid('user-1'),
          organizationId: ORG_A,
          roleId: 'ANALYST',
        }),
      });
      throw new Error('expected ANALYST to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
    expect(webhookClient.posts).toHaveLength(0);
    expect(outgoingEvents.all()).toHaveLength(0);
  });
});

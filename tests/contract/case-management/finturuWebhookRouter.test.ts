import crypto from 'crypto';
import request from 'supertest';
import express from 'express';
import { finturuWebhookRouter } from '../../../src/modules/case-management/infrastructure/adapters/inbound/http/finturuWebhookRouter.js';
import { Case } from '../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { brand } from '../../../src/shared/kernel/Brand.js';

describe('finturuWebhookRouter (HTTP Contract)', () => {
  const secretKey = crypto.randomBytes(32).toString('base64');

  const mockIngest = jest.fn().mockImplementation(async (input: { rawPayload: Record<string, unknown> }) => {
    const raw = input.rawPayload;
    const kase = Case.create({
      id: createCaseId('66bc11112222333344445555'),
      organizationId: 'org-test',
      customerId: (raw.idUser as string) ?? 'cust-123',
      bridgeUserId: (raw.idUserBridge as string) ?? null,
      bridgeWallet: (raw.address as string) ?? null,
      stripeCustomerId: (raw.idCustomer as string) ?? null,
      riskScore: createRiskScore(typeof raw.risk_score === 'number' ? raw.risk_score : 50),
      priority: createCasePriority('HIGH'),
      now: brand<string, 'Instant'>('2026-08-14T18:00:00.000Z'),
    });
    return { case: kase, outboxEventId: 'outbox-123' };
  });

  const app = express();
  app.use(express.json());
  app.use(finturuWebhookRouter({
    ingestFinturuCase: mockIngest as any,
    encryptionKey: secretKey,
    defaultOrganizationId: 'org-test',
  }));

  beforeEach(() => {
    mockIngest.mockClear();
  });

  it('accepts unencrypted JSON payload at POST /webhooks/finturu', async () => {
    const payload = {
      idUser: 'usr_finturu_456',
      idUserBridge: 'cus_bridge_123',
      address: '0x1234abcd5678',
      idCustomer: 'cus_stripe_ABC123',
      risk_score: 78,
    };

    const res = await request(app)
      .post('/webhooks/finturu')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.caseId).toBe('66bc11112222333344445555');
    expect(res.body.status).toBe('OPEN');
    expect(res.body.customerId).toBe('usr_finturu_456');
    expect(res.body.bridgeUserId).toBe('cus_bridge_123');
    expect(res.body.bridgeWallet).toBe('0x1234abcd5678');
    expect(res.body.stripeCustomerId).toBe('cus_stripe_ABC123');
    expect(mockIngest).toHaveBeenCalledTimes(1);
  });

  it('accepts AES-256-GCM encrypted payload at POST /cases/webhook/finturu', async () => {
    const payload = {
      idUser: 'usr_encrypted_999',
      idUserBridge: 'cus_bridge_999',
      address: '0x9999wallet',
      idCustomer: 'cus_stripe_999',
      risk_score: 85,
    };

    const key = Buffer.from(secretKey, 'base64');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const encryptedBody = {
      iv: iv.toString('base64'),
      data: encrypted.toString('base64'),
      authTag: authTag.toString('base64'),
    };

    const res = await request(app)
      .post('/cases/webhook/finturu')
      .send(encryptedBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.customerId).toBe('usr_encrypted_999');
    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        rawPayload: payload,
      })
    );
  });
});

import crypto from 'crypto';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoCaseRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRepository.js';
import { MongoTimelineRecorder } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoTimelineRecorder.js';
import { MongoOutboxEventRepository } from '../../../src/shared/outbox/mongo/MongoOutboxEventRepository.js';
import { generateOutboxEventId } from '../../../src/shared/outbox/OutboxEventId.js';
import { MongoUnitOfWork } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoAuditLogRepository } from '../../../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from '../../../src/modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from '../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { createCaseManagementAuditRecorderAdapter } from '../../../src/composition/caseManagementAuditRecorderAdapter.js';
import { createIngestFinturuCaseUseCase } from '../../../src/modules/case-management/application/IngestFinturuCase.js';
import { decryptFinturuPayload } from '../../../src/modules/case-management/infrastructure/adapters/inbound/http/FinturuPayloadDecryptor.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { createInitializeCaseSlaService } from '../../../src/modules/case-management/application/InitializeCaseSla.js';
import { MongoCaseSlaTrackingRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseSlaTrackingRepository.js';
import { MongoOrganizationFraudConfigRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoOrganizationFraudConfigRepository.js';
import { generateCaseSlaTrackingId } from '../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';

jest.setTimeout(120_000);

describe('IngestFinturuCase (integration)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let cases: MongoCaseRepository;
  let timelineRecorder: MongoTimelineRecorder;
  let outbox: MongoOutboxEventRepository;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
    await ensureIndexes(db);
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  beforeEach(() => {
    cases = new MongoCaseRepository(db);
    timelineRecorder = new MongoTimelineRecorder(db);
    outbox = new MongoOutboxEventRepository(db);
  });

  it('ingests a consolidated plain JSON payload into cases, timeline, audit_logs, and outbox_events', async () => {
    const clock = new SystemClock();
    const auditLogs = new MongoAuditLogRepository(db);
    const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock, generateAuditLogId });
    const auditRecorder = createCaseManagementAuditRecorderAdapter(recordAuditLog);
    const unitOfWork = new MongoUnitOfWork(client);

    const ingest = createIngestFinturuCaseUseCase({
      cases,
      timelineRecorder,
      outbox,
      unitOfWork,
      clock,
      generateCaseId,
      generateTimelineEventId,
      generateOutboxEventId,
      auditRecorder,
      initializeCaseSla: createInitializeCaseSlaService({
        slaTracking: new MongoCaseSlaTrackingRepository(db),
        fraudConfig: new MongoOrganizationFraudConfigRepository(db),
        generateCaseSlaTrackingId,
      }),
    });

    const samplePayload = {
      organization_id: '019d7e58aed0777318d11d4d',
      idUser: 'usr_finturu_456',
      idUserBridge: 'cus_bridge_123',
      address: '0x1234abcd5678',
      idCustomer: 'cus_stripe_ABC123',
      name: 'Juan',
      lastname: 'Pérez',
      email: 'juan.perez@email.com',
      risk_score: 78,
      wallets: [
        {
          idWallet: 'wal_abc123',
          address: '0x1234abcd5678',
          balances: [{ currency: 'usdc', balance: '150.25' }],
        },
      ],
      transfers: [
        {
          idTransfer: 'trf_001',
          amount: '500.00',
          currency: 'usd',
          state: 'completed',
        },
      ],
      coinflow: null,
    };

    const result = await ingest({ rawPayload: samplePayload });

    expect(result.case.id).toBeDefined();
    expect(result.case.customerId).toBe('usr_finturu_456');
    expect(result.case.bridgeUserId).toBe('cus_bridge_123');
    expect(result.case.bridgeWallet).toBe('0x1234abcd5678');
    expect(result.case.stripeCustomerId).toBe('cus_stripe_ABC123');
    expect(result.case.customerEmail).toBe('juan.perez@email.com');
    expect(result.case.riskScore).toBe(78);
    expect(result.case.status).toBe('OPEN');
    expect(result.case.priority).toBe('HIGH');
    expect(result.case.finturuCacheSnapshot).toEqual(samplePayload);

    // 1. Verify Cases collection
    const caseDoc = await db.collection('cases').findOne({ _id: new ObjectId(result.case.id) });
    expect(caseDoc).not.toBeNull();
    expect(caseDoc?.customer_id).toBe('usr_finturu_456');
    expect(caseDoc?.status).toBe('OPEN');
    expect(caseDoc?.finturu_cache_snapshot).toBeDefined();

    // 2. Verify CaseTimeline collection
    const timelineDocs = await db.collection('case_timeline').find({ case_id: new ObjectId(result.case.id) }).toArray();
    expect(timelineDocs).toHaveLength(1);
    expect(timelineDocs[0].event_type).toBe('CASE_CREATED');
    expect(timelineDocs[0].new_value).toBe('OPEN');

    // 3. Verify AuditLogs collection
    const auditDocs = await db.collection('audit_logs').find({ resource_id: result.case.id }).toArray();
    expect(auditDocs).toHaveLength(1);
    expect(auditDocs[0].action).toBe('CREATE_CASE');
    expect(auditDocs[0].detail.source).toBe('WEBHOOK_FINTURU');

    // 4. Verify OutboxEvents collection
    const outboxDoc = await db.collection('outbox_events').findOne({ aggregate_id: result.case.id });
    expect(outboxDoc).not.toBeNull();
    expect(outboxDoc?.event_type).toBe('case.created');
    expect(outboxDoc?.status).toBe('PENDING');
  });

  it('decrypts AES-256-GCM payload correctly and ingests it', async () => {
    const rawSecretKey = crypto.randomBytes(32).toString('base64');
    const key = Buffer.from(rawSecretKey, 'base64');
    const iv = crypto.randomBytes(12);

    const payload = {
      idUser: 'usr_encrypted_999',
      idUserBridge: 'cus_bridge_999',
      address: '0x9999wallet',
      idCustomer: 'cus_stripe_999',
      email: 'enc@finturu.com',
      risk_score: 92,
    };

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const encryptedBody = {
      iv: iv.toString('base64'),
      data: encrypted.toString('base64'),
      authTag: authTag.toString('base64'),
    };

    const decrypted = decryptFinturuPayload(encryptedBody, rawSecretKey);
    expect(decrypted).toEqual(payload);

    const clock = new SystemClock();
    const auditLogs = new MongoAuditLogRepository(db);
    const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock, generateAuditLogId });
    const auditRecorder = createCaseManagementAuditRecorderAdapter(recordAuditLog);
    const unitOfWork = new MongoUnitOfWork(client);

    const ingest = createIngestFinturuCaseUseCase({
      cases,
      timelineRecorder,
      outbox,
      unitOfWork,
      clock,
      generateCaseId,
      generateTimelineEventId,
      generateOutboxEventId,
      auditRecorder,
      initializeCaseSla: createInitializeCaseSlaService({
        slaTracking: new MongoCaseSlaTrackingRepository(db),
        fraudConfig: new MongoOrganizationFraudConfigRepository(db),
        generateCaseSlaTrackingId,
      }),
    });

    // El payload cifrado no trae organizacion, asi que se pasa explicitamente
    // igual que hace `finturuWebhookRouter` con `defaultOrganizationId`.
    const result = await ingest({ rawPayload: decrypted, organizationId: '019d7e58aed0777318d11d4d' });
    expect(result.case.customerId).toBe('usr_encrypted_999');
    expect(result.case.priority).toBe('CRITICAL');
  });
});

import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoUserRepositoryFactory } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUserRepositoryFactory.js';
import { MongoSessionRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoSessionRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoAuditLogRepository } from '../../../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from '../../../src/modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from '../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { createAuditRecorderAdapter } from '../../../src/composition/auditRecorderAdapter.js';
import { createCreateUserUseCase } from '../../../src/modules/identity-access/application/CreateUser.js';
import { createTransitionUserStatusUseCase } from '../../../src/modules/identity-access/application/TransitionUserStatus.js';
import { createPatchUserIdentityUseCase } from '../../../src/modules/identity-access/application/PatchUserIdentity.js';
import { FakePasswordHasher } from '../../helpers/identity-access/FakePasswordHasher.js';
import { InMemoryRoleRepository } from '../../helpers/identity-access/InMemoryRoleRepository.js';
import type { AuditEvent, AuditRecorder } from '../../../src/modules/identity-access/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../src/modules/identity-access/domain/ports/UnitOfWork.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { User } from '../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createRoleId } from '../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_ID = createOrganizationId('org-1');
const ORG_USER = createAuthContext({ userId: 'admin-user', organizationId: 'org-1', actorType: 'ORGANIZATION' });

/** Throws on the Nth call to `record`, letting earlier calls hit real Mongo — proves partial-write rollback. */
function failOnNthCall(recorder: AuditRecorder, failAt: number): AuditRecorder {
  let calls = 0;
  return {
    async record(event: AuditEvent, tx?: Transaction): Promise<void> {
      calls += 1;
      if (calls === failAt) {
        throw new Error('induced audit failure mid-transaction');
      }
      await recorder.record(event, tx);
    },
  };
}

describe('User use-case audit atomicity (integration, real replica-set Mongo transaction)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let userRepositoryFactory: MongoUserRepositoryFactory;
  let sessions: MongoSessionRepository;
  let baseAuditRecorder: AuditRecorder;

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
    userRepositoryFactory = new MongoUserRepositoryFactory(db);
    sessions = new MongoSessionRepository(db);
    const auditLogs = new MongoAuditLogRepository(db);
    const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock: new SystemClock(), generateAuditLogId });
    baseAuditRecorder = createAuditRecorderAdapter(recordAuditLog);
  });

  afterEach(async () => {
    await db.collection('Users').deleteMany({});
    await db.collection('AuditLogs').deleteMany({});
  });

  async function seedUser(id = 'user-1', email = 'alice@example.com'): Promise<void> {
    await userRepositoryFactory.forTenant(ORG_ID).save(
      User.create({
        id: createUserId(id),
        organizationId: ORG_ID,
        email: createEmail(email),
        credential: createPasswordCredential('hash'),
        firstName: 'Alice',
        lastName: 'Smith',
        roleId: createRoleId('ANALYST'),
        now: NOW,
      }),
    );
  }

  function buildCreate(auditRecorder: AuditRecorder) {
    return createCreateUserUseCase({
      userRepositoryFactory,
      passwordHasher: new FakePasswordHasher(),
      unitOfWork: new MongoUnitOfWork(client),
      clock: new SystemClock(),
      generateId: () => createUserId('user-1'),
      auditRecorder,
      roleRepository: new InMemoryRoleRepository(),
    });
  }

  function buildTransition(auditRecorder: AuditRecorder) {
    return createTransitionUserStatusUseCase({
      userRepositoryFactory,
      sessions,
      unitOfWork: new MongoUnitOfWork(client),
      clock: new SystemClock(),
      auditRecorder,
    });
  }

  function buildPatch(auditRecorder: AuditRecorder) {
    return createPatchUserIdentityUseCase({
      userRepositoryFactory,
      unitOfWork: new MongoUnitOfWork(client),
      clock: new SystemClock(),
      auditRecorder,
    });
  }

  it('CreateUser commits exactly one USER_CREATED audit row atomically with the user', async () => {
    const createUser = buildCreate(baseAuditRecorder);

    await createUser({ auth: ORG_USER, email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', roleId: 'ANALYST' });

    const persisted = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId('user-1'));
    expect(persisted).not.toBeNull();
    const auditRows = await db.collection('AuditLogs').find({}).toArray();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.Action).toBe('USER_CREATED');
  });

  it('CreateUser rolls back the user AND persists NO audit row when the audit write fails', async () => {
    const createUser = buildCreate(failOnNthCall(baseAuditRecorder, 1));

    await expect(
      createUser({ auth: ORG_USER, email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', roleId: 'ANALYST' }),
    ).rejects.toThrow('induced audit failure mid-transaction');

    const persisted = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId('user-1'));
    expect(persisted).toBeNull();
    const auditRows = await db.collection('AuditLogs').find({}).toArray();
    expect(auditRows).toHaveLength(0);
  });

  it('TransitionUserStatus rolls back the status change AND persists NO audit row when the audit write fails', async () => {
    await seedUser('user-1');
    const transition = buildTransition(failOnNthCall(baseAuditRecorder, 1));

    await expect(
      transition({ auth: ORG_USER, userId: 'user-1', next: 'SUSPENDED' }),
    ).rejects.toThrow('induced audit failure mid-transaction');

    const persisted = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId('user-1'));
    expect(persisted?.status).toBe('ACTIVE');
    const auditRows = await db.collection('AuditLogs').find({}).toArray();
    expect(auditRows).toHaveLength(0);
  });

  it('PatchUserIdentity rolls back the patch AND persists NO audit row when the audit write fails', async () => {
    await seedUser('user-1');
    const patch = buildPatch(failOnNthCall(baseAuditRecorder, 1));

    await expect(
      patch({ auth: ORG_USER, userId: 'user-1', firstName: 'Alicia' }),
    ).rejects.toThrow('induced audit failure mid-transaction');

    const persisted = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId('user-1'));
    expect(persisted?.firstName).toBe('Alice');
    const auditRows = await db.collection('AuditLogs').find({}).toArray();
    expect(auditRows).toHaveLength(0);
  });
});

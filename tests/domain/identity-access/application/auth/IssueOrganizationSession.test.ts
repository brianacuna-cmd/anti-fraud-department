import { oid } from '../../../../support/oid.js';
import { createIssueOrganizationSessionUseCase } from '../../../../../src/modules/identity-access/application/auth/IssueOrganizationSession.js';
import { createAuthenticateActorUseCase } from '../../../../../src/modules/identity-access/application/auth/AuthenticateActor.js';
import { createSessionIssuer } from '../../../../../src/modules/identity-access/application/auth/SessionIssuer.js';
import { InMemoryActorCredentialGateway } from '../../../../helpers/identity-access/InMemoryActorCredentialGateway.js';
import { InMemorySessionRepository } from '../../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUnitOfWork } from '../../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FakePasswordHasher } from '../../../../helpers/identity-access/FakePasswordHasher.js';
import { FixedClock } from '../../../../helpers/FixedClock.js';
import { AesGcmSessionTokenService } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { AesGcmSecretCipher } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { createOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createPasswordCredential } from '../../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';
import type { ActorCredentialRecord } from '../../../../../src/modules/identity-access/domain/ports/ActorCredentialGateway.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const DUMMY_CREDENTIAL = createPasswordCredential('hashed:dummy-password');
const SECRET_CIPHER = new AesGcmSecretCipher('test-secret', 1);
const TOKEN_SERVICE = new AesGcmSessionTokenService(SECRET_CIPHER);

// OrganizationActorGateway returns organizationId: null with the org's own
// id in actorId — reproduced here so the use case's derivation is exercised
// exactly like the real gateway (design DD1).
const ORG_RECORD: ActorCredentialRecord = {
  actorId: oid('org-1'),
  actorType: 'ORGANIZATION',
  organizationId: null,
  credential: createPasswordCredential('hashed:org-password'),
  lockout: { loginAttempts: 0, blockedUntil: null },
  status: 'ACTIVE',
  mfa: { enabled: false, secret: null },
};

function buildHarness() {
  const gateway = new InMemoryActorCredentialGateway();
  const passwordHasher = new FakePasswordHasher();
  const auditRecorder = new InMemoryAuditRecorder();
  const sessions = new InMemorySessionRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  const authenticateActor = createAuthenticateActorUseCase({
    gateway,
    passwordHasher,
    clock: new FixedClock(NOW),
    dummyCredential: DUMMY_CREDENTIAL,
    actorType: 'ORGANIZATION',
    auditRecorder,
  });
  const issueSessionFor = createSessionIssuer({
    sessionTokenService: TOKEN_SERVICE,
    sessions,
    tokenKeyVersion: 1,
    ttls: { sessionSeconds: 900 },
  });
  const issueOrganizationSession = createIssueOrganizationSessionUseCase({
    authenticateActor,
    issueSessionFor,
    unitOfWork,
    clock: new FixedClock(NOW),
    auditRecorder,
  });
  return { gateway, sessions, unitOfWork, auditRecorder, issueOrganizationSession };
}

describe('createIssueOrganizationSessionUseCase', () => {
  it('mints ACCESS+REFRESH for valid ORG credentials, with organizationId derived from actor.actorId and userId null', async () => {
    const { gateway, sessions, unitOfWork, auditRecorder, issueOrganizationSession } = buildHarness();
    gateway.seed('org@acme.example.com', ORG_RECORD);

    const result = await issueOrganizationSession({ email: 'org@acme.example.com', password: 'org-password' });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(unitOfWork.transactionCount).toBe(1);

    const saved = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(result.accessToken));
    expect(saved?.userId).toBeNull();
    expect(saved?.organizationId).toBe(createOrganizationId(oid('org-1')));
    expect(saved?.actorType).toBe('ORGANIZATION');

    const loginEvents = auditRecorder.all().filter((event) => event.action === 'LOGIN');
    expect(loginEvents.length).toBeGreaterThanOrEqual(1);
    const mintLogin = auditRecorder.calls().find((call) => call.event.action === 'LOGIN' && call.tx !== undefined);
    expect(mintLogin).toBeDefined();
    expect(mintLogin?.event.resource).toBe('sessions');
    expect(mintLogin?.event.organizationId).toBe(createOrganizationId(oid('org-1')));
  });

  it('rejects invalid ORG credentials with LOGIN_FAILED audit and no session created', async () => {
    const { gateway, sessions, auditRecorder, issueOrganizationSession } = buildHarness();
    gateway.seed('org@acme.example.com', ORG_RECORD);

    await expect(
      issueOrganizationSession({ email: 'org@acme.example.com', password: 'wrong-password' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(auditRecorder.all().some((event) => event.action === 'LOGIN_FAILED')).toBe(true);
    expect(await sessions.findByTokenHash('anything')).toBeNull();
  });

  it('rejects a locked ORG account with ACCOUNT_LOCKED and no session created', async () => {
    const { gateway, sessions, issueOrganizationSession } = buildHarness();
    gateway.seed('org@acme.example.com', {
      ...ORG_RECORD,
      lockout: { loginAttempts: 5, blockedUntil: fromDate(new Date('2026-01-01T01:00:00.000Z')) },
    });

    await expect(
      issueOrganizationSession({ email: 'org@acme.example.com', password: 'org-password' }),
    ).rejects.toBeInstanceOf(IdentityAccessError);

    expect(await sessions.findByTokenHash('anything')).toBeNull();
  });
});

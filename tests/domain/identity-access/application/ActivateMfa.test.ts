import { authenticator } from 'otplib';
import { createActivateMfaUseCase } from '../../../../src/modules/identity-access/application/ActivateMfa.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { OtplibTotpService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/mfa/OtplibTotpService.js';
import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ACTIVATED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const AUTH = createAuthContext({ userId: 'user-1', organizationId: 'org-1', isPlatformAdmin: false });
const SECRET_CIPHER = new AesGcmSecretCipher('test-secret', 1);
const TOTP_SERVICE = new OtplibTotpService();

async function seedUserWithPendingSecret(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  plaintextSecret: string,
): Promise<void> {
  const org = createOrganizationId('org-1');
  const user = User.create({
    id: createUserId('user-1'),
    organizationId: org,
    email: createEmail('alice@example.com'),
    credential: createPasswordCredential('hash'),
    firstName: 'Alice',
    lastName: 'Smith',
    now: CREATED_AT,
  }).startMfaEnrollment(SECRET_CIPHER.encrypt(plaintextSecret), CREATED_AT);
  await userRepositoryFactory.forTenant(org).save(user);
}

function buildUseCase(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  unitOfWork: InMemoryUnitOfWork,
  auditRecorder: InMemoryAuditRecorder = new InMemoryAuditRecorder(),
) {
  return createActivateMfaUseCase({
    userRepositoryFactory,
    unitOfWork,
    clock: new FixedClock(ACTIVATED_AT),
    totpService: TOTP_SERVICE,
    secretCipher: SECRET_CIPHER,
    auditRecorder,
  });
}

describe('createActivateMfaUseCase', () => {
  it('enables MFA and emits MFA_ENABLED when the token is valid', async () => {
    const plaintextSecret = TOTP_SERVICE.generateSecret();
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUserWithPendingSecret(userRepositoryFactory, plaintextSecret);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const activateMfa = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder);
    const token = authenticator.generate(plaintextSecret);

    const user = await activateMfa({ auth: AUTH, token });

    expect(user.mfa.enabled).toBe(true);
    expect(unitOfWork.transactionCount).toBe(1);
    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeDefined();
    expect(calls[0].event.action).toBe('MFA_ENABLED');
    expect(calls[0].event.resource).toBe('users');
    expect(calls[0].event.resourceId).toBe('user-1');
  });

  it('rejects a wrong token with MFA_TOKEN_INVALID and does NOT enable MFA', async () => {
    const plaintextSecret = TOTP_SERVICE.generateSecret();
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUserWithPendingSecret(userRepositoryFactory, plaintextSecret);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const activateMfa = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder);

    expect.assertions(4);
    try {
      await activateMfa({ auth: AUTH, token: '000000' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('MFA_TOKEN_INVALID');
    }

    const stored = await userRepositoryFactory.forTenant(createOrganizationId('org-1')).findById(createUserId('user-1'));
    expect(stored!.mfa.enabled).toBe(false);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('rejects activation with no pending enrollment (MFA_ENROLLMENT_NOT_PENDING)', async () => {
    const org = createOrganizationId('org-1');
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const user = User.create({
      id: createUserId('user-1'),
      organizationId: org,
      email: createEmail('alice@example.com'),
      credential: createPasswordCredential('hash'),
      firstName: 'Alice',
      lastName: 'Smith',
      now: CREATED_AT,
    });
    await userRepositoryFactory.forTenant(org).save(user);
    const unitOfWork = new InMemoryUnitOfWork();
    const activateMfa = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await activateMfa({ auth: AUTH, token: '123456' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('MFA_ENROLLMENT_NOT_PENDING');
    }
  });

  it('rejects an unknown authenticated user with USER_NOT_FOUND', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const unitOfWork = new InMemoryUnitOfWork();
    const activateMfa = buildUseCase(userRepositoryFactory, unitOfWork);

    await expect(activateMfa({ auth: AUTH, token: '123456' })).rejects.toBeInstanceOf(IdentityAccessError);
  });
});

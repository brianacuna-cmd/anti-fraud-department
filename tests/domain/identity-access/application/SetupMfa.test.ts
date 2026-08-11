import { createSetupMfaUseCase } from '../../../../src/modules/identity-access/application/SetupMfa.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { FakeQrCodeGenerator } from '../../../helpers/identity-access/FakeQrCodeGenerator.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { OtplibTotpService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/mfa/OtplibTotpService.js';
import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createRoleId } from '../../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const SETUP_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const AUTH = createAuthContext({ userId: 'user-1', organizationId: 'org-1', isPlatformAdmin: false });
const ISSUER = 'AntiFraud';

async function seedUser(userRepositoryFactory: InMemoryUserRepositoryFactory): Promise<void> {
  const org = createOrganizationId('org-1');
  const user = User.create({
    id: createUserId('user-1'),
    organizationId: org,
    email: createEmail('alice@example.com'),
    credential: createPasswordCredential('hash'),
    firstName: 'Alice',
    lastName: 'Smith',
    roleId: createRoleId('ANALYST'),
    now: CREATED_AT,
  });
  await userRepositoryFactory.forTenant(org).save(user);
}

function buildUseCase(userRepositoryFactory: InMemoryUserRepositoryFactory, unitOfWork: InMemoryUnitOfWork) {
  return createSetupMfaUseCase({
    userRepositoryFactory,
    unitOfWork,
    clock: new FixedClock(SETUP_AT),
    totpService: new OtplibTotpService(),
    qrCodeGenerator: new FakeQrCodeGenerator(),
    secretCipher: new AesGcmSecretCipher('test-secret', 1),
    issuer: ISSUER,
  });
}

describe('createSetupMfaUseCase', () => {
  it('starts MFA enrollment inside a transaction, storing an encrypted (not plaintext) secret', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const setupMfa = buildUseCase(userRepositoryFactory, unitOfWork);

    const result = await setupMfa({ auth: AUTH });

    expect(unitOfWork.transactionCount).toBe(1);
    expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.otpauthUri).toContain('otpauth://totp/');
    expect(result.otpauthUri).toContain(encodeURIComponent(ISSUER));

    const stored = await userRepositoryFactory.forTenant(createOrganizationId('org-1')).findById(createUserId('user-1'));
    expect(stored!.mfa.enabled).toBe(false);
    expect(stored!.mfa.secret).not.toBeNull();
    expect(stored!.mfa.secret).not.toEqual(expect.stringContaining('otpauth'));
    // the plaintext secret never leaks into the stored (encrypted) value
    const secretParam = new URL(result.otpauthUri).searchParams.get('secret');
    expect(stored!.mfa.secret).not.toBe(secretParam);
  });

  it('rejects an unknown authenticated user with USER_NOT_FOUND', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const unitOfWork = new InMemoryUnitOfWork();
    const setupMfa = buildUseCase(userRepositoryFactory, unitOfWork);

    await expect(setupMfa({ auth: AUTH })).rejects.toBeInstanceOf(IdentityAccessError);
  });
});

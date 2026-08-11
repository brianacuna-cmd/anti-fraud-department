import { createRequestPasswordResetUseCase } from '../../../../src/modules/identity-access/application/auth/RequestPasswordReset.js';
import { InMemoryOrganizationRepository } from '../../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FakeEmailSender } from '../../../helpers/identity-access/FakeEmailSender.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { Organization } from '../../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { generateOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createRoleId } from '../../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import type { EmailSender } from '../../../../src/modules/identity-access/domain/ports/EmailSender.js';
import type { AuditRecorder } from '../../../../src/modules/identity-access/domain/ports/AuditRecorder.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const NOW = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_ID = generateOrganizationId();
const TOKEN_SERVICE = new AesGcmSessionTokenService(new AesGcmSecretCipher('test-secret', 1));

function buildFixture() {
  const organizations = new InMemoryOrganizationRepository();
  const userRepositoryFactory = new InMemoryUserRepositoryFactory();
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const emailSender = new FakeEmailSender();
  const clock = new FixedClock(NOW);

  const requestPasswordReset = createRequestPasswordResetUseCase({
    organizations,
    userRepositoryFactory,
    sessionTokenService: TOKEN_SERVICE,
    unitOfWork,
    emailSender,
    auditRecorder,
    clock,
    tokenKeyVersion: 1,
    resetTtlSeconds: 900,
    emailFrom: 'fraud@backendstudio.tech',
    resetLinkBaseUrl: 'https://app.example.com/reset',
  });

  return { organizations, userRepositoryFactory, unitOfWork, auditRecorder, emailSender, requestPasswordReset };
}

async function seedOrgAndUser(
  organizations: InMemoryOrganizationRepository,
  userRepositoryFactory: InMemoryUserRepositoryFactory,
): Promise<void> {
  const organization = Organization.create({
    id: ORG_ID,
    slug: createSlug('acme'),
    name: 'Acme',
    now: CREATED_AT,
  });
  await organizations.save(organization);

  const user = User.create({
    id: createUserId('user-1'),
    organizationId: ORG_ID,
    email: createEmail('alice@example.com'),
    credential: createPasswordCredential('hashed:whatever'),
    firstName: 'Alice',
    lastName: 'Smith',
    roleId: createRoleId('ANALYST'),
    now: CREATED_AT,
  });
  await userRepositoryFactory.forTenant(ORG_ID).save(user);
}

describe('createRequestPasswordResetUseCase', () => {
  it('mints and stores a hashed reset token and sends an email + audit event for a matching user', async () => {
    const { organizations, userRepositoryFactory, auditRecorder, emailSender, requestPasswordReset } = buildFixture();
    await seedOrgAndUser(organizations, userRepositoryFactory);

    const result = await requestPasswordReset({ email: 'alice@example.com', organizationSlug: 'acme' });

    expect(result).toEqual({ status: 'PASSWORD_RESET_REQUESTED' });

    const stored = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId('user-1'));
    expect(stored?.resetToken).not.toBeNull();
    expect(stored?.resetToken?.expiresAt).toBe(fromDate(new Date('2026-01-02T00:15:00.000Z')));

    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0].to).toBe('alice@example.com');
    expect(emailSender.sent[0].from).toBe('fraud@backendstudio.tech');
    expect(emailSender.sent[0].text).toContain('https://app.example.com/reset?token=');

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].event.action).toBe('PASSWORD_RESET_REQUESTED');
    expect(calls[0].event.resource).toBe('users');
    expect(calls[0].event.resourceId).toBe('user-1');
  });

  it('returns the identical opaque result for an unknown email, storing nothing and sending nothing', async () => {
    const { organizations, userRepositoryFactory, auditRecorder, emailSender, requestPasswordReset } = buildFixture();
    await seedOrgAndUser(organizations, userRepositoryFactory);

    const result = await requestPasswordReset({ email: 'nobody@example.com', organizationSlug: 'acme' });

    expect(result).toEqual({ status: 'PASSWORD_RESET_REQUESTED' });
    const stored = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId('user-1'));
    expect(stored?.resetToken).toBeNull();
    expect(emailSender.sent).toHaveLength(0);
    expect(auditRecorder.calls()).toHaveLength(0);
  });

  it('returns the identical opaque result for an unknown organizationSlug', async () => {
    const { organizations, userRepositoryFactory, auditRecorder, emailSender, requestPasswordReset } = buildFixture();
    await seedOrgAndUser(organizations, userRepositoryFactory);

    const result = await requestPasswordReset({ email: 'alice@example.com', organizationSlug: 'unknown-org' });

    expect(result).toEqual({ status: 'PASSWORD_RESET_REQUESTED' });
    expect(emailSender.sent).toHaveLength(0);
    expect(auditRecorder.calls()).toHaveLength(0);
  });

  it('returns the identical opaque result when organizationSlug is missing entirely', async () => {
    const { organizations, userRepositoryFactory, auditRecorder, emailSender, requestPasswordReset } = buildFixture();
    await seedOrgAndUser(organizations, userRepositoryFactory);

    const result = await requestPasswordReset({ email: 'alice@example.com' });

    expect(result).toEqual({ status: 'PASSWORD_RESET_REQUESTED' });
    expect(emailSender.sent).toHaveLength(0);
    expect(auditRecorder.calls()).toHaveLength(0);
  });

  it('returns the identical opaque result for a malformed (VO-invalid) email, without throwing', async () => {
    const { organizations, userRepositoryFactory, auditRecorder, emailSender, requestPasswordReset } = buildFixture();
    await seedOrgAndUser(organizations, userRepositoryFactory);

    const result = await requestPasswordReset({ email: 'not-an-email', organizationSlug: 'acme' });

    expect(result).toEqual({ status: 'PASSWORD_RESET_REQUESTED' });
    expect(emailSender.sent).toHaveLength(0);
    expect(auditRecorder.calls()).toHaveLength(0);
  });

  it('returns the identical opaque result for a malformed (VO-invalid) organizationSlug', async () => {
    const { organizations, userRepositoryFactory, auditRecorder, emailSender, requestPasswordReset } = buildFixture();
    await seedOrgAndUser(organizations, userRepositoryFactory);

    const result = await requestPasswordReset({ email: 'alice@example.com', organizationSlug: 'Not A Slug!' });

    expect(result).toEqual({ status: 'PASSWORD_RESET_REQUESTED' });
    expect(emailSender.sent).toHaveLength(0);
    expect(auditRecorder.calls()).toHaveLength(0);
  });

  it('still stores the token and returns opaque success when the email send throws (best-effort)', async () => {
    const organizations = new InMemoryOrganizationRepository();
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedOrgAndUser(organizations, userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const throwingEmailSender: EmailSender = {
      send: async () => {
        throw new Error('provider down');
      },
    };

    const requestPasswordReset = createRequestPasswordResetUseCase({
      organizations,
      userRepositoryFactory,
      sessionTokenService: TOKEN_SERVICE,
      unitOfWork,
      emailSender: throwingEmailSender,
      auditRecorder,
      clock: new FixedClock(NOW),
      tokenKeyVersion: 1,
      resetTtlSeconds: 900,
      emailFrom: 'fraud@backendstudio.tech',
      resetLinkBaseUrl: 'https://app.example.com/reset',
    });

    const result = await requestPasswordReset({ email: 'alice@example.com', organizationSlug: 'acme' });

    expect(result).toEqual({ status: 'PASSWORD_RESET_REQUESTED' });
    const stored = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId('user-1'));
    expect(stored?.resetToken).not.toBeNull();
    expect(auditRecorder.calls()).toHaveLength(1);
  });

  it('still stores the token, still sends the email, and returns opaque success when the audit write throws (best-effort)', async () => {
    const organizations = new InMemoryOrganizationRepository();
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedOrgAndUser(organizations, userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const emailSender = new FakeEmailSender();
    const throwingAuditRecorder: AuditRecorder = {
      record: async () => {
        throw new Error('audit store down');
      },
    };

    const requestPasswordReset = createRequestPasswordResetUseCase({
      organizations,
      userRepositoryFactory,
      sessionTokenService: TOKEN_SERVICE,
      unitOfWork,
      emailSender,
      auditRecorder: throwingAuditRecorder,
      clock: new FixedClock(NOW),
      tokenKeyVersion: 1,
      resetTtlSeconds: 900,
      emailFrom: 'fraud@backendstudio.tech',
      resetLinkBaseUrl: 'https://app.example.com/reset',
    });

    const result = await requestPasswordReset({ email: 'alice@example.com', organizationSlug: 'acme' });

    expect(result).toEqual({ status: 'PASSWORD_RESET_REQUESTED' });
    const stored = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId('user-1'));
    expect(stored?.resetToken).not.toBeNull();
    expect(emailSender.sent).toHaveLength(1);
  });

  it('overwrites any prior pending reset token (latest-wins) on a second request', async () => {
    const { organizations, userRepositoryFactory, requestPasswordReset } = buildFixture();
    await seedOrgAndUser(organizations, userRepositoryFactory);

    await requestPasswordReset({ email: 'alice@example.com', organizationSlug: 'acme' });
    const firstHash = (await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId('user-1')))?.resetToken?.hash;

    await requestPasswordReset({ email: 'alice@example.com', organizationSlug: 'acme' });
    const secondHash = (await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId('user-1')))?.resetToken?.hash;

    expect(firstHash).toBeDefined();
    expect(secondHash).toBeDefined();
    expect(secondHash).not.toBe(firstHash);
  });
});

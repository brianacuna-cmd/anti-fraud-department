import { oid } from '../../../support/oid.js';
import { createTransitionOrganizationStatusUseCase } from '../../../../src/modules/identity-access/application/TransitionOrganizationStatus.js';
import { InMemoryOrganizationRepository } from '../../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { Organization } from '../../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { Session } from '../../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createSessionId } from '../../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createFamilyId } from '../../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const TRANSITIONED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({
  userId: oid('u1'),
  organizationId: oid('o0'),
  isPlatformAdmin: true,
  ipAddress: '203.0.113.10',
});
const REGULAR_USER = createAuthContext({ userId: oid('u2'), organizationId: oid('o1'), isPlatformAdmin: false });

async function seedOrganization(
  organizations: InMemoryOrganizationRepository,
  status: 'ACTIVE' | 'CANCELLED' = 'ACTIVE',
): Promise<void> {
  let organization = Organization.create({
    id: createOrganizationId(oid('org-1')),
    name: 'Acme',
    slug: createSlug('acme'),
    now: CREATED_AT,
  });
  if (status === 'CANCELLED') {
    organization = organization.transitionTo('CANCELLED', { isPlatformAdmin: true }, CREATED_AT);
  }
  await organizations.save(organization);
}

function buildSession(id: string): Session {
  return Session.create({
    id: createSessionId(id),
    userId: oid('org-user-1'),
    organizationId: createOrganizationId(oid('org-1')),
    actorType: 'USER',
    tokenHash: `token-hash-${id}`,
    refreshTokenHash: `refresh-hash-${id}`,
    expiresAt: TRANSITIONED_AT,
    refreshExpiresAt: TRANSITIONED_AT,
    familyId: createFamilyId(oid('family-1')),
    familyExpiresAt: TRANSITIONED_AT,
    now: CREATED_AT,
  });
}

function buildUseCase(
  organizations: InMemoryOrganizationRepository,
  unitOfWork: InMemoryUnitOfWork,
  sessions: InMemorySessionRepository = new InMemorySessionRepository(),
  auditRecorder: InMemoryAuditRecorder = new InMemoryAuditRecorder(),
) {
  return createTransitionOrganizationStatusUseCase({
    organizations,
    sessions,
    unitOfWork,
    clock: new FixedClock(TRANSITIONED_AT),
    auditRecorder,
  });
}

describe('createTransitionOrganizationStatusUseCase', () => {
  it('runs the transition inside a unit-of-work transaction and persists the result', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork);

    const organization = await transitionOrganizationStatus({
      auth: PLATFORM_ADMIN,
      organizationId: oid('org-1'),
      next: 'SUSPENDED',
    });

    expect(organization.status).toBe('SUSPENDED');
    expect(unitOfWork.transactionCount).toBe(1);
    const persisted = await organizations.findById(createOrganizationId(oid('org-1')));
    expect(persisted?.status).toBe('SUSPENDED');
  });

  it('rejects an unknown id with ORGANIZATION_NOT_FOUND', async () => {
    const organizations = new InMemoryOrganizationRepository();
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork);

    expect.assertions(2);
    try {
      await transitionOrganizationStatus({ auth: PLATFORM_ADMIN, organizationId: oid('missing'), next: 'SUSPENDED' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ORGANIZATION_NOT_FOUND');
    }
  });

  it('sets DeletedAt to the transition instant when transitioning to CANCELLED', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork);

    const organization = await transitionOrganizationStatus({
      auth: PLATFORM_ADMIN,
      organizationId: oid('org-1'),
      next: 'CANCELLED',
    });

    expect(organization.status).toBe('CANCELLED');
    expect(organization.deletedAt).toBe(TRANSITIONED_AT);
    const persisted = await organizations.findById(createOrganizationId(oid('org-1')));
    expect(persisted?.deletedAt).toBe(TRANSITIONED_AT);
  });

  it('rejects any transition out of CANCELLED, by any actor, as INVALID_TRANSITION', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations, 'CANCELLED');
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork);

    expect.assertions(2);
    try {
      await transitionOrganizationStatus({ auth: PLATFORM_ADMIN, organizationId: oid('org-1'), next: 'ACTIVE' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
    }
  });

  it('rejects a no-op transition (ACTIVE -> ACTIVE) as INVALID_TRANSITION', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork);

    expect.assertions(2);
    try {
      await transitionOrganizationStatus({ auth: PLATFORM_ADMIN, organizationId: oid('org-1'), next: 'ACTIVE' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
    }
  });

  it('rejects a non-platform-admin caller with FORBIDDEN_CROSS_TENANT before touching the aggregate', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork);

    expect.assertions(3);
    try {
      await transitionOrganizationStatus({ auth: REGULAR_USER, organizationId: oid('org-1'), next: 'SUSPENDED' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(unitOfWork.transactionCount).toBe(0);
  });

  it('emits exactly one ORGANIZATION_STATUS_CHANGED audit event, threaded with the tx, for a non-CANCELLED transition', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork, new InMemorySessionRepository(), auditRecorder);

    await transitionOrganizationStatus({ auth: PLATFORM_ADMIN, organizationId: oid('org-1'), next: 'SUSPENDED' });

    expect(auditRecorder.all()).toHaveLength(1);
    const [event] = auditRecorder.all();
    expect(event).toMatchObject({
      organizationId: oid('org-1'),
      actorType: 'PLATFORM_ADMIN',
      actorId: oid('u1'),
      action: 'ORGANIZATION_STATUS_CHANGED',
      resource: 'organizations',
      resourceId: oid('org-1'),
      detail: { from: 'ACTIVE', to: 'SUSPENDED' },
      ipAddress: '203.0.113.10',
    });
    expect(auditRecorder.calls()[0]?.tx).toBeDefined();
  });

  it('on CANCELLED, revokes all sessions for the organization and emits ORGANIZATION_SESSIONS_REVOKED + ORGANIZATION_STATUS_CHANGED', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const unitOfWork = new InMemoryUnitOfWork();
    const sessions = new InMemorySessionRepository();
    await sessions.save(buildSession(oid('session-1')));
    await sessions.save(buildSession(oid('session-2')));
    const auditRecorder = new InMemoryAuditRecorder();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork, sessions, auditRecorder);

    await transitionOrganizationStatus({ auth: PLATFORM_ADMIN, organizationId: oid('org-1'), next: 'CANCELLED' });

    const revokedSession1 = await sessions.findByTokenHash(`token-hash-${oid('session-1')}`);
    const revokedSession2 = await sessions.findByTokenHash(`token-hash-${oid('session-2')}`);
    expect(revokedSession1?.deletedAt).toBe(TRANSITIONED_AT);
    expect(revokedSession2?.deletedAt).toBe(TRANSITIONED_AT);

    expect(auditRecorder.all()).toHaveLength(2);
    const [sessionsRevoked, statusChanged] = auditRecorder.all();
    expect(sessionsRevoked).toMatchObject({
      organizationId: oid('org-1'),
      action: 'ORGANIZATION_SESSIONS_REVOKED',
      resource: 'sessions',
      resourceId: null,
      detail: { revokedCount: 2 },
    });
    expect(statusChanged).toMatchObject({
      organizationId: oid('org-1'),
      action: 'ORGANIZATION_STATUS_CHANGED',
      resource: 'organizations',
      resourceId: oid('org-1'),
      detail: { from: 'ACTIVE', to: 'CANCELLED' },
    });
  });

  it('does not emit ORGANIZATION_SESSIONS_REVOKED for a non-CANCELLED transition', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork, new InMemorySessionRepository(), auditRecorder);

    await transitionOrganizationStatus({ auth: PLATFORM_ADMIN, organizationId: oid('org-1'), next: 'SUSPENDED' });

    expect(auditRecorder.all().some((event) => event.action === 'ORGANIZATION_SESSIONS_REVOKED')).toBe(false);
  });
});

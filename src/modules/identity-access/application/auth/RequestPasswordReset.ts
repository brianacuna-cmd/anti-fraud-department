import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import { fromDate, toDate } from '../../../../shared/time/Instant.js';
import type { OrganizationRepository } from '../../domain/ports/OrganizationRepository.js';
import type { UserRepositoryFactory } from '../../domain/ports/UserRepositoryFactory.js';
import type { SessionTokenService } from '../../domain/ports/SessionTokenService.js';
import type { UnitOfWork } from '../../domain/ports/UnitOfWork.js';
import type { EmailSender } from '../../domain/ports/EmailSender.js';
import type { AuditRecorder } from '../../domain/ports/AuditRecorder.js';
import type { User } from '../../domain/model/aggregates/User.js';
import { createSlug } from '../../domain/model/value-objects/Slug.js';
import { createEmail } from '../../domain/model/value-objects/Email.js';
import { IdentityAccessError } from '../../domain/errors/IdentityAccessError.js';

export interface RequestPasswordResetInput {
  readonly email: string;
  /**
   * Optional at this type's boundary (mirrors `ActorCredentialLookup`,
   * `AuthenticateActorInput`) — a request with no slug is resolved to "no
   * match", not rejected, so opacity holds regardless of whether the slug
   * is missing, unknown, or matches no user (design §5).
   */
  readonly organizationSlug?: string;
  readonly ipAddress?: string | null;
}

export interface RequestPasswordResetResult {
  readonly status: 'PASSWORD_RESET_REQUESTED';
}

export interface RequestPasswordResetDeps {
  readonly organizations: OrganizationRepository;
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly sessionTokenService: SessionTokenService;
  readonly unitOfWork: UnitOfWork;
  readonly emailSender: EmailSender;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
  readonly tokenKeyVersion: number;
  readonly resetTtlSeconds: number;
  readonly emailFrom: string;
  readonly resetLinkBaseUrl: string;
}

function addSeconds(instant: Instant, seconds: number): Instant {
  return fromDate(new Date(toDate(instant).getTime() + seconds * 1000));
}

/**
 * Resolves `(email, organizationSlug)` to a `User`, mirroring
 * `UserActorGateway.findByEmail`'s opacity contract exactly (design §5): a
 * missing slug, an unknown slug, an unknown email, or a malformed
 * slug/email (VO `INVARIANT_VIOLATION`) are ALL treated identically as "no
 * match" (`null`) — never surfaced as a distinguishable error. Any OTHER
 * error (e.g. an infra failure) is rethrown — opacity only covers
 * user-existence, not genuine outages.
 */
async function resolveUser(
  input: RequestPasswordResetInput,
  deps: Pick<RequestPasswordResetDeps, 'organizations' | 'userRepositoryFactory'>,
): Promise<User | null> {
  if (!input.organizationSlug) {
    return null;
  }
  try {
    const slug = createSlug(input.organizationSlug);
    const organization = await deps.organizations.findBySlug(slug);
    if (!organization) {
      return null;
    }
    const email = createEmail(input.email);
    return await deps.userRepositoryFactory.forTenant(organization.id).findByEmail(email);
  } catch (error) {
    if (error instanceof IdentityAccessError && error.code === 'INVARIANT_VIOLATION') {
      return null;
    }
    throw error;
  }
}

/**
 * Request Password Reset (unauthenticated, password-management PR-2b, spec
 * "Request Password Reset"). ALWAYS returns the identical opaque success —
 * no user-enumeration, no timing oracle (design §5: unlike
 * `AuthenticateActor`, there is no password check on this path at all, so
 * no dummy-hash trick is needed either — resolution alone is already
 * opaque). Best-effort email + audit swallow every exception individually
 * (mirrors `AuthenticateActor.emit`) so a delivery failure or an
 * audit-write failure never changes the response OR blocks the other.
 */
export function createRequestPasswordResetUseCase(deps: RequestPasswordResetDeps) {
  return async function requestPasswordReset(input: RequestPasswordResetInput): Promise<RequestPasswordResetResult> {
    const user = await resolveUser(input, deps);

    if (user) {
      const now = deps.clock.now();
      const jti = randomUUID();
      const expiresAt = addSeconds(now, deps.resetTtlSeconds);

      const token = deps.sessionTokenService.issue({
        tokenType: 'password_reset',
        keyVersion: deps.tokenKeyVersion,
        jti,
        userId: user.id,
        organizationId: user.organizationId,
        actorType: 'USER',
        expiresAt,
      });

      const updated = user.beginPasswordReset(
        { hash: deps.sessionTokenService.fingerprint(jti), expiresAt },
        now,
      );
      await deps.unitOfWork.withTransaction(async (tx) => {
        await deps.userRepositoryFactory.forTenant(user.organizationId).save(updated, tx);
      });

      try {
        await deps.emailSender.send({
          to: user.email,
          from: deps.emailFrom,
          subject: 'Reset your password',
          text: `Use this link to reset your password: ${deps.resetLinkBaseUrl}?token=${token}`,
        });
      } catch {
        // best-effort: never let an email delivery failure change the response
      }

      try {
        await deps.auditRecorder.record({
          organizationId: user.organizationId,
          actorType: 'USER',
          actorId: user.id,
          action: 'PASSWORD_RESET_REQUESTED',
          resource: 'users',
          resourceId: user.id,
          detail: {},
          ipAddress: input.ipAddress ?? null,
        });
      } catch {
        // best-effort: never let an audit-write failure change the response
      }
    }

    return { status: 'PASSWORD_RESET_REQUESTED' };
  };
}

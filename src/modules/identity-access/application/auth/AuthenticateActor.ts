import type { Clock } from '../../../../shared/time/Clock.js';
import type { ActorCredentialGateway } from '../../domain/ports/ActorCredentialGateway.js';
import type { PasswordHasher } from '../../domain/ports/PasswordHasher.js';
import type { PasswordCredential } from '../../domain/model/value-objects/PasswordCredential.js';
import type { OrganizationId } from '../../domain/model/value-objects/OrganizationId.js';
import type { AuditRecorder, AuditEvent } from '../../domain/ports/AuditRecorder.js';
import { isLocked, registerFailure } from '../../domain/services/LockoutPolicy.js';
import { accountLocked, invalidCredentials } from '../../domain/errors/IdentityAccessError.js';

export interface AuthenticateActorInput {
  readonly email: string;
  readonly password: string;
  /** REQUIRED by the Users tier (design D29); ignored by the Organizations tier. */
  readonly organizationSlug?: string;
  /**
   * Sourced from `req.ip` at the HTTP edge (design D-A7/§4a: "Login captures
   * IP from input" — no `AuthContext` exists pre-authentication, unlike
   * every post-auth use case). Plumbing only in this PR: no audit emission
   * reads it yet (`AuthenticateActor` gains `auditRecorder` in a later
   * stacked PR, design "Login atomicity caveat").
   */
  readonly ipAddress?: string | null;
}

/**
 * A tier-agnostic identity, deliberately not the full `ActorCredentialRecord`
 * — nothing past this point (Phase 5's MFA challenge, Phase 8's session
 * issuance) needs the credential/lockout internals back.
 */
export interface AuthenticatedActor {
  readonly actorId: string;
  readonly actorType: 'USER' | 'ORGANIZATION';
  readonly organizationId: OrganizationId | null;
}

export interface AuthenticateActorDeps {
  readonly gateway: ActorCredentialGateway;
  readonly passwordHasher: PasswordHasher;
  readonly clock: Clock;
  /**
   * A pre-built `PasswordCredential` over `BcryptPasswordHasher`'s
   * `DUMMY_PASSWORD_HASH` (design D24), injected rather than imported
   * directly: `application` may only depend on its own module's `domain`
   * (eslint `boundaries`) — `DUMMY_PASSWORD_HASH` lives in `infrastructure`.
   * `main.ts` constructs this once via `createPasswordCredential(DUMMY_PASSWORD_HASH)`.
   */
  readonly dummyCredential: PasswordCredential;
  /**
   * The tier this instance authenticates ('USER' or 'ORGANIZATION'), supplied
   * at the composition root. Needed to stamp `ActorType` on a `LOGIN_FAILED`
   * audit event when the email/organization is unknown and no actor was ever
   * resolved (design "audit every failed login").
   */
  readonly actorType: 'USER' | 'ORGANIZATION';
  /** Emits LOGIN / LOGIN_FAILED audit events (best-effort, non-transactional). */
  readonly auditRecorder: AuditRecorder;
}

/**
 * ONE service parameterized by `ActorCredentialGateway` (design D19) — both
 * tiers share identical credential-check + lockout rules. Stops at
 * "credentials valid" (design Data Flow: only `POST /auth/{tier}/mfa`
 * issues a `Sessions` row, in Phase 5) — this use case never touches
 * `SessionRepository`.
 */
export function createAuthenticateActorUseCase(deps: AuthenticateActorDeps) {
  /**
   * Best-effort, NON-transactional audit emission (design "Login atomicity
   * caveat"): login/failed-login run before any `AuthContext` or transaction
   * exists, and a failed attempt THROWS — so wrapping the audit write in the
   * caller's transaction would roll the `LOGIN_FAILED` row back. A failed
   * audit write must NEVER turn a valid login (or a correct rejection) into a
   * different outcome, so any error here is swallowed.
   */
  async function emit(event: AuditEvent): Promise<void> {
    try {
      await deps.auditRecorder.record(event);
    } catch {
      // best-effort: never let an audit failure change the authentication result
    }
  }

  return async function authenticateActor(input: AuthenticateActorInput): Promise<AuthenticatedActor> {
    const now = deps.clock.now();
    const ipAddress = input.ipAddress ?? null;
    const actor = await deps.gateway.findByEmail({
      email: input.email,
      organizationSlug: input.organizationSlug,
    });

    if (actor === null) {
      // Unknown email/organizationSlug: still pays the full bcrypt cost
      // against a fixed dummy hash so failure timing is uniform and the
      // response is non-enumerable (design D24, "No Email-Existence Leak").
      await deps.passwordHasher.verify(input.password, deps.dummyCredential);
      await emit({
        organizationId: null,
        actorType: deps.actorType,
        actorId: null,
        action: 'LOGIN_FAILED',
        resource: 'sessions',
        resourceId: null,
        detail: { reason: 'INVALID_CREDENTIALS', email: input.email },
        ipAddress,
      });
      throw invalidCredentials();
    }

    if (isLocked(actor.lockout, now)) {
      // Blocked account skips the password check entirely (account-lockout
      // spec: "Blocked account rejects without checking the password").
      await emit({
        organizationId: actor.organizationId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'LOGIN_FAILED',
        resource: 'sessions',
        resourceId: null,
        detail: { reason: 'ACCOUNT_LOCKED', email: input.email },
        ipAddress,
      });
      throw accountLocked(actor.lockout.blockedUntil as string);
    }

    const passwordValid = await deps.passwordHasher.verify(input.password, actor.credential);
    if (!passwordValid) {
      const nextLockout = registerFailure(actor.lockout, now);
      await deps.gateway.registerLoginFailure(actor, nextLockout, now);
      const nowLocked = isLocked(nextLockout, now);
      await emit({
        organizationId: actor.organizationId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'LOGIN_FAILED',
        resource: 'sessions',
        resourceId: null,
        detail: { reason: nowLocked ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS', email: input.email },
        ipAddress,
      });
      if (nowLocked) {
        throw accountLocked(nextLockout.blockedUntil as string);
      }
      throw invalidCredentials();
    }

    await deps.gateway.registerLoginSuccess(actor, now);
    await emit({
      organizationId: actor.organizationId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'LOGIN',
      resource: 'sessions',
      resourceId: null,
      detail: {},
      ipAddress,
    });

    return { actorId: actor.actorId, actorType: actor.actorType, organizationId: actor.organizationId };
  };
}

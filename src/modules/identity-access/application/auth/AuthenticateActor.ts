import type { Clock } from '../../../../shared/time/Clock.js';
import type { ActorCredentialGateway } from '../../domain/ports/ActorCredentialGateway.js';
import type { PasswordHasher } from '../../domain/ports/PasswordHasher.js';
import type { PasswordCredential } from '../../domain/model/value-objects/PasswordCredential.js';
import type { OrganizationId } from '../../domain/model/value-objects/OrganizationId.js';
import { isLocked, registerFailure } from '../../domain/services/LockoutPolicy.js';
import { accountLocked, invalidCredentials } from '../../domain/errors/IdentityAccessError.js';

export interface AuthenticateActorInput {
  readonly email: string;
  readonly password: string;
  /** REQUIRED by the Users tier (design D29); ignored by the Organizations tier. */
  readonly organizationSlug?: string;
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
}

/**
 * ONE service parameterized by `ActorCredentialGateway` (design D19) — both
 * tiers share identical credential-check + lockout rules. Stops at
 * "credentials valid" (design Data Flow: only `POST /auth/{tier}/mfa`
 * issues a `Sessions` row, in Phase 5) — this use case never touches
 * `SessionRepository`.
 */
export function createAuthenticateActorUseCase(deps: AuthenticateActorDeps) {
  return async function authenticateActor(input: AuthenticateActorInput): Promise<AuthenticatedActor> {
    const now = deps.clock.now();
    const actor = await deps.gateway.findByEmail({
      email: input.email,
      organizationSlug: input.organizationSlug,
    });

    if (actor === null) {
      // Unknown email/organizationSlug: still pays the full bcrypt cost
      // against a fixed dummy hash so failure timing is uniform and the
      // response is non-enumerable (design D24, "No Email-Existence Leak").
      await deps.passwordHasher.verify(input.password, deps.dummyCredential);
      throw invalidCredentials();
    }

    if (isLocked(actor.lockout, now)) {
      // Blocked account skips the password check entirely (account-lockout
      // spec: "Blocked account rejects without checking the password").
      throw accountLocked(actor.lockout.blockedUntil as string);
    }

    const passwordValid = await deps.passwordHasher.verify(input.password, actor.credential);
    if (!passwordValid) {
      const nextLockout = registerFailure(actor.lockout, now);
      await deps.gateway.registerLoginFailure(actor, nextLockout, now);
      if (isLocked(nextLockout, now)) {
        throw accountLocked(nextLockout.blockedUntil as string);
      }
      throw invalidCredentials();
    }

    await deps.gateway.registerLoginSuccess(actor, now);

    return { actorId: actor.actorId, actorType: actor.actorType, organizationId: actor.organizationId };
  };
}

import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import { fromDate, toDate } from '../../../../shared/time/Instant.js';
import type { SessionTokenService, ScopedMfaTokenType } from '../../domain/ports/SessionTokenService.js';
import type { MfaChallengeStore } from '../../domain/ports/MfaChallengeStore.js';
import type { createAuthenticateActorUseCase, AuthenticateActorInput } from './AuthenticateActor.js';

export type BeginUserLoginResult =
  | { readonly kind: 'challenge'; readonly token: string }
  | { readonly kind: 'enrollment'; readonly token: string };

export interface BeginUserLoginDeps {
  readonly authenticateActor: ReturnType<typeof createAuthenticateActorUseCase>;
  readonly sessionTokenService: SessionTokenService;
  readonly mfaChallenges: MfaChallengeStore;
  readonly clock: Clock;
  readonly tokenKeyVersion: number;
  readonly challengeTtlSeconds: number;
  readonly enrollmentTtlSeconds: number;
}

function addSeconds(instant: Instant, seconds: number): Instant {
  return fromDate(new Date(toDate(instant).getTime() + seconds * 1000));
}

/**
 * Step-1 login wrapper for the USER tier (design "Technical Approach",
 * two-step-login). Delegates entirely to the unchanged `AuthenticateActor`
 * for credential/lockout verification and best-effort LOGIN/LOGIN_FAILED
 * audit — this wrapper only runs AFTER that succeeds, and only decides which
 * single-use scoped token (`mfa_challenge` if `mfa.enabled`, `mfa_enrollment`
 * otherwise) to mint and append to the `MfaChallenges` store (design D1/D2).
 *
 * PR2 scope: the `mfa_enrollment` branch mints a real token now (task 2.1),
 * but nothing enforces the scoped `AuthContext` on `setup`/`activate` yet —
 * that authorization wiring (`requireScopedAuthContext` on `userRouter`) and
 * `ActivateMfa`'s `SessionIssuer` hand-off are PR3 (design PR Slicing,
 * Slice 3). Minting the token in this PR keeps `BeginUserLogin` a single,
 * complete USE CASE rather than half-implemented, matching the tasks doc.
 */
export function createBeginUserLoginUseCase(deps: BeginUserLoginDeps) {
  return async function beginUserLogin(input: AuthenticateActorInput): Promise<BeginUserLoginResult> {
    const actor = await deps.authenticateActor(input);
    const now = deps.clock.now();

    const tokenType: ScopedMfaTokenType = actor.mfa.enabled ? 'mfa_challenge' : 'mfa_enrollment';
    const ttlSeconds = actor.mfa.enabled ? deps.challengeTtlSeconds : deps.enrollmentTtlSeconds;
    const jti = randomUUID();
    const expiresAt = addSeconds(now, ttlSeconds);

    await deps.mfaChallenges.append({
      jti,
      userId: actor.actorId,
      organizationId: actor.organizationId,
      actorType: 'USER',
      tokenType,
      expiresAt,
      now,
    });

    const token = deps.sessionTokenService.issue({
      tokenType,
      keyVersion: deps.tokenKeyVersion,
      jti,
      userId: actor.actorId,
      organizationId: actor.organizationId,
      actorType: 'USER',
      expiresAt,
    });

    return actor.mfa.enabled ? { kind: 'challenge', token } : { kind: 'enrollment', token };
  };
}

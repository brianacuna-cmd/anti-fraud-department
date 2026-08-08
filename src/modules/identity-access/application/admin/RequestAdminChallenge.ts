import { randomBytes } from 'node:crypto';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import { fromDate, toDate } from '../../../../shared/time/Instant.js';
import type { AdminOrganizationRepository } from '../../domain/ports/AdminOrganizationRepository.js';
import type { AdminChallengeStore } from '../../domain/ports/AdminChallengeStore.js';
import { createAdminOrganizationId } from '../../domain/model/value-objects/AdminOrganizationId.js';
import { adminChallengeInvalid } from '../../domain/errors/IdentityAccessError.js';

export interface RequestAdminChallengeInput {
  readonly adminOrganizationId: string;
}

export interface RequestAdminChallengeResult {
  readonly challengeId: string;
  readonly challenge: string;
  readonly expiresAt: string;
}

export interface RequestAdminChallengeDeps {
  readonly admins: AdminOrganizationRepository;
  readonly adminChallenges: AdminChallengeStore;
  readonly clock: Clock;
  readonly challengeTtlSeconds: number;
}

function addSeconds(instant: Instant, seconds: number): Instant {
  return fromDate(new Date(toDate(instant).getTime() + seconds * 1000));
}

/**
 * Step 1 of PLATFORM_ADMIN challenge-login (design "Use cases",
 * `RequestAdminChallenge`). Public/unauthenticated — this IS the login, no
 * `AuthContext` exists yet. Deliberately opaque on failure (design
 * "no oracle"): an unknown `adminOrganizationId` and an admin with no
 * ACTIVE key both reject with the SAME `adminChallengeInvalid`, so this
 * endpoint never becomes an admin-id enumeration oracle.
 *
 * `challengeId` (store key) and `challenge` (the signed secret) are
 * deliberately SEPARATE random values (design "Ed25519 SignatureVerifier"):
 * `challengeId = randomBytes(16)`, `challenge = randomBytes(32)`, both
 * base64url-encoded.
 */
export function createRequestAdminChallengeUseCase(deps: RequestAdminChallengeDeps) {
  return async function requestAdminChallenge(
    input: RequestAdminChallengeInput,
  ): Promise<RequestAdminChallengeResult> {
    const now = deps.clock.now();

    const adminOrganizationId = createAdminOrganizationId(input.adminOrganizationId);
    const admin = await deps.admins.findById(adminOrganizationId);
    if (!admin || admin.activeKey() === null) {
      throw adminChallengeInvalid();
    }

    const challengeId = randomBytes(16).toString('base64url');
    const challenge = randomBytes(32).toString('base64url');
    const expiresAt = addSeconds(now, deps.challengeTtlSeconds);

    await deps.adminChallenges.append({
      challengeId,
      adminOrganizationId: admin.id,
      challenge,
      expiresAt,
      now,
    });

    return { challengeId, challenge, expiresAt: toDate(expiresAt).toISOString() };
  };
}

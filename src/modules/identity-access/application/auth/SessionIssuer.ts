import type { Instant } from '../../../../shared/time/Instant.js';
import { fromDate, toDate } from '../../../../shared/time/Instant.js';
import type { SessionTokenService } from '../../domain/ports/SessionTokenService.js';
import type { SessionRepository } from '../../domain/ports/SessionRepository.js';
import type { Transaction } from '../../domain/ports/UnitOfWork.js';
import type { OrganizationId } from '../../domain/model/value-objects/OrganizationId.js';
import type { ActorType } from '../../domain/model/value-objects/ActorType.js';
import { Session } from '../../domain/model/aggregates/Session.js';
import { generateSessionId } from '../../domain/model/value-objects/SessionId.js';
import { generateFamilyId } from '../../domain/model/value-objects/FamilyId.js';

export interface SessionIssuerTtls {
  readonly sessionSeconds: number;
  readonly refreshSeconds: number;
  readonly familySeconds: number;
}

export interface SessionIssuerDeps {
  readonly sessionTokenService: SessionTokenService;
  readonly sessions: SessionRepository;
  readonly tokenKeyVersion: number;
  readonly ttls: SessionIssuerTtls;
}

export interface IssueForActorInput {
  readonly userId: string | null;
  readonly organizationId: OrganizationId | null;
  readonly actorType: ActorType;
  readonly now: Instant;
  readonly tx: Transaction;
}

export interface MintedSession {
  readonly accessToken: string;
  /** Nullable — the `PLATFORM_ADMIN` tier issues no refresh token (design D38). Non-null for USER/ORGANIZATION. */
  readonly refreshToken: string | null;
  readonly expiresAt: string;
}

function addSeconds(instant: Instant, seconds: number): Instant {
  return fromDate(new Date(toDate(instant).getTime() + seconds * 1000));
}

/**
 * Shared session-minting collaborator (design D4) — the ONE implementation
 * both `IssueSession` (challenge path, this PR) and `ActivateMfa` (forced
 * enrollment, PR3) call, inside the CALLER's already-open transaction. Never
 * opens its own transaction and never touches `MfaChallengeStore` — the
 * jti-consume step is the caller's responsibility, since "consume jti FIRST,
 * mint SECOND" (design "IssueSession flow") only makes sense decided at the
 * call site, not buried inside a shared collaborator.
 */
export function createSessionIssuer(deps: SessionIssuerDeps) {
  return async function issueSessionFor(input: IssueForActorInput): Promise<MintedSession> {
    const sessionId = generateSessionId();
    const familyId = generateFamilyId();
    const expiresAt = addSeconds(input.now, deps.ttls.sessionSeconds);
    const familyExpiresAt = addSeconds(input.now, deps.ttls.familySeconds);
    // design D38: PLATFORM_ADMIN sessions issue NO refresh token — skip
    // minting it entirely rather than minting-then-discarding, so a
    // never-issued token can never accidentally leak.
    const isAdmin = input.actorType === 'PLATFORM_ADMIN';
    const refreshExpiresAt = isAdmin ? null : addSeconds(input.now, deps.ttls.refreshSeconds);

    const accessToken = deps.sessionTokenService.issue({
      sessionId,
      tokenType: 'ACCESS',
      keyVersion: deps.tokenKeyVersion,
    });
    const refreshToken = isAdmin
      ? null
      : deps.sessionTokenService.issue({
          sessionId,
          tokenType: 'REFRESH',
          keyVersion: deps.tokenKeyVersion,
        });

    const session = Session.create({
      id: sessionId,
      userId: input.userId,
      organizationId: input.organizationId,
      actorType: input.actorType,
      tokenHash: deps.sessionTokenService.fingerprint(accessToken),
      refreshTokenHash: refreshToken ? deps.sessionTokenService.fingerprint(refreshToken) : null,
      expiresAt,
      refreshExpiresAt,
      familyId,
      familyExpiresAt,
      now: input.now,
    });

    await deps.sessions.save(session, input.tx);

    return { accessToken, refreshToken, expiresAt };
  };
}

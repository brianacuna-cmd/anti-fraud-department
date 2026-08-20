import type { Instant } from '../../../../shared/time/Instant.js';
import { fromDate, toDate } from '../../../../shared/time/Instant.js';
import type { SessionTokenService } from '../../domain/ports/SessionTokenService.js';
import type { SessionRepository } from '../../domain/ports/SessionRepository.js';
import type { Transaction } from '../../domain/ports/UnitOfWork.js';
import type { OrganizationId } from '../../domain/model/value-objects/OrganizationId.js';
import type { AdminOrganizationId } from '../../domain/model/value-objects/AdminOrganizationId.js';
import { Session } from '../../domain/model/aggregates/Session.js';
import { generateSessionId } from '../../domain/model/value-objects/SessionId.js';

export interface SessionIssuerTtls {
  readonly sessionSeconds: number;
}

export interface SessionIssuerDeps {
  readonly sessionTokenService: SessionTokenService;
  readonly sessions: SessionRepository;
  readonly tokenKeyVersion: number;
  readonly ttls: SessionIssuerTtls;
}

export interface IssueForActorInput {
  readonly userId?: string | null;
  readonly organizationId?: OrganizationId | null;
  readonly adminOrganizationId?: AdminOrganizationId | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly now: Instant;
  readonly tx: Transaction;
}

export interface MintedSession {
  readonly accessToken: string;
  /** Pointer-only; not persisted. Null for PLATFORM_ADMIN. */
  readonly refreshToken: string | null;
  readonly expiresAt: string;
}

function addSeconds(instant: Instant, seconds: number): Instant {
  return fromDate(new Date(toDate(instant).getTime() + seconds * 1000));
}

/**
 * Shared session-minting collaborator — the ONE implementation both
 * `IssueSession` and `ActivateMfa` call, inside the CALLER's already-open
 * transaction. Never opens its own transaction and never touches
 * `MfaChallengeStore`.
 */
export function createSessionIssuer(deps: SessionIssuerDeps) {
  return async function issueSessionFor(input: IssueForActorInput): Promise<MintedSession> {
    const sessionId = generateSessionId();
    const expiresAt = addSeconds(input.now, deps.ttls.sessionSeconds);

    const accessToken = deps.sessionTokenService.issue({
      sessionId,
      tokenType: 'ACCESS',
      keyVersion: deps.tokenKeyVersion,
    });
    const isAdmin = (input.adminOrganizationId ?? null) !== null;
    const refreshToken = isAdmin
      ? null
      : deps.sessionTokenService.issue({
          sessionId,
          tokenType: 'REFRESH',
          keyVersion: deps.tokenKeyVersion,
        });

    const session = Session.create({
      id: sessionId,
      userId: input.userId ?? null,
      organizationId: input.organizationId ?? null,
      adminOrganizationId: input.adminOrganizationId ?? null,
      tokenHash: deps.sessionTokenService.fingerprint(accessToken),
      expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      now: input.now,
    });

    await deps.sessions.save(session, input.tx);

    return { accessToken, refreshToken, expiresAt };
  };
}

import type { Clock } from '../../../../shared/time/Clock.js';
import type { UnitOfWork } from '../../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../../domain/ports/AuditRecorder.js';
import { createOrganizationId } from '../../domain/model/value-objects/OrganizationId.js';
import type { createAuthenticateActorUseCase, AuthenticateActorInput } from './AuthenticateActor.js';
import type { createSessionIssuer, MintedSession } from './SessionIssuer.js';

export type IssueOrganizationSessionResult = MintedSession;

export interface IssueOrganizationSessionDeps {
  /** The ORGANIZATION-tier instance (design DD1) — bound at composition root with `actorType: 'ORGANIZATION'`. */
  readonly authenticateActor: ReturnType<typeof createAuthenticateActorUseCase>;
  readonly issueSessionFor: ReturnType<typeof createSessionIssuer>;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
}

/**
 * ORGANIZATION-tier login (design "1. ORG login use case —
 * `IssueOrganizationSession`", session-lifecycle PR-1). Single-step, unlike
 * the USER tier's two-step MFA flow — an ORGANIZATION actor never branches
 * on MFA (design DD1), so credential verification and session minting
 * happen in one call.
 *
 * CRITICAL: `OrganizationActorGateway` resolves an ORGANIZATION actor with
 * `organizationId: null` (the org IS the tenant, not scoped by one) and
 * carries the organization's own id in `actor.actorId` instead — so the
 * minted session's `organizationId` MUST be derived from `actor.actorId`,
 * never from `actor.organizationId` (design "CRITICAL" callout).
 *
 * `authenticateActor` runs OUTSIDE the transaction — it throws on bad
 * credentials and emits its own best-effort, non-transactional LOGIN/
 * LOGIN_FAILED audit (same atomicity caveat as the USER two-step flow).
 * Minting the session and emitting the session-level LOGIN audit happen
 * together, INSIDE one transaction.
 */
export function createIssueOrganizationSessionUseCase(deps: IssueOrganizationSessionDeps) {
  return async function issueOrganizationSession(
    input: AuthenticateActorInput,
  ): Promise<IssueOrganizationSessionResult> {
    const actor = await deps.authenticateActor(input);
    const now = deps.clock.now();

    return deps.unitOfWork.withTransaction(async (tx) => {
      const organizationId = createOrganizationId(actor.actorId);

      const minted = await deps.issueSessionFor({
        organizationId,
        ipAddress: input.ipAddress ?? null,
        now,
        tx,
      });

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: 'ORGANIZATION',
          actorId: actor.actorId,
          action: 'LOGIN',
          resource: 'sessions',
          resourceId: null,
          detail: { via: 'organization_credentials' },
          ipAddress: input.ipAddress ?? null,
        },
        tx,
      );

      return minted;
    });
  };
}

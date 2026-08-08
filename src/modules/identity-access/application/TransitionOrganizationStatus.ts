import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { OrganizationRepository } from '../domain/ports/OrganizationRepository.js';
import type { SessionRepository } from '../domain/ports/SessionRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { Organization } from '../domain/model/aggregates/Organization.js';
import type { OrganizationStatus } from '../domain/model/value-objects/OrganizationStatus.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createTransitionActor } from '../domain/model/value-objects/TransitionActor.js';
import { organizationNotFound } from '../domain/errors/IdentityAccessError.js';
import { requirePlatformAdmin } from './authorization/requirePlatformAdmin.js';

export interface TransitionOrganizationStatusInput {
  readonly auth: AuthContext;
  readonly organizationId: string;
  /**
   * Internal field name stays `next` (design D21: "keeping
   * TransitionOrganizationStatus's internal name confines the diff to
   * router + DTO + tests") even though the HTTP body field is `status`
   * (`PATCH /organizations/:id/status`, `organizationRouter.ts` maps it).
   */
  readonly next: OrganizationStatus;
}

export interface TransitionOrganizationStatusDeps {
  readonly organizations: OrganizationRepository;
  /** NEW (audit-logs-foundation Phase 4): revokes sessions on CANCELLED. */
  readonly sessions: SessionRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /** NEW (audit-logs-foundation Phase 4): emits ORGANIZATION_STATUS_CHANGED (+ ORGANIZATION_SESSIONS_REVOKED on CANCELLED). */
  readonly auditRecorder: AuditRecorder;
}

/**
 * Backs both `PATCH /organizations/:id/status` (design D21, supersedes
 * `POST /organizations/:id/transition`) and `DELETE /organizations/:id`
 * (organization-lifecycle spec: "Soft Delete as Status Transition").
 * Wrapped in `UnitOfWork.withTransaction` (design D6) even though a
 * single-aggregate write is already atomic in Mongo — establishes the
 * transactional read-modify-write shape ahead of Phase 3's genuine
 * multi-document bootstrap.
 *
 * audit-logs-foundation Phase 4 (spec "Organization Cancellation Revokes
 * Sessions", design §3/§6): NOW binds `tx` and threads it to
 * `organizations.save`, `sessions.revokeAllForOrganization`, and both audit
 * emissions, so the status change, the session revocation (CANCELLED only),
 * and the audit row(s) all commit or roll back together.
 */
export function createTransitionOrganizationStatusUseCase(deps: TransitionOrganizationStatusDeps) {
  return async function transitionOrganizationStatus(
    input: TransitionOrganizationStatusInput,
  ): Promise<Organization> {
    requirePlatformAdmin(input.auth);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const id = createOrganizationId(input.organizationId);
      const organization = await deps.organizations.findById(id);
      if (!organization) {
        throw organizationNotFound(input.organizationId);
      }

      const actor = createTransitionActor(input.auth.isPlatformAdmin);
      const from = organization.status;
      const now = deps.clock.now();
      const transitioned = organization.transitionTo(input.next, actor, now);
      await deps.organizations.save(transitioned, tx);

      if (input.next === 'CANCELLED') {
        const revokedCount = await deps.sessions.revokeAllForOrganization(id, now, tx);
        await deps.auditRecorder.record(
          {
            organizationId: id,
            actorType: input.auth.actorType,
            actorId: input.auth.userId,
            action: 'ORGANIZATION_SESSIONS_REVOKED',
            resource: 'sessions',
            resourceId: null,
            detail: { revokedCount },
            ipAddress: input.auth.ipAddress,
          },
          tx,
        );
      }

      await deps.auditRecorder.record(
        {
          organizationId: id,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'ORGANIZATION_STATUS_CHANGED',
          resource: 'organizations',
          resourceId: id,
          detail: { from, to: input.next },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return transitioned;
    });
  };
}

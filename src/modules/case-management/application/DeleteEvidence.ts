import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Evidence } from '../domain/model/aggregates/Evidence.js';
import type { EvidenceRepository } from '../domain/ports/EvidenceRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createEvidenceId } from '../domain/model/value-objects/EvidenceId.js';
import { evidenceNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const DELETE_EVIDENCE_ROLES = ['SUPERVISOR', 'ADMIN'] as const;

export interface DeleteEvidenceInput {
  readonly auth: AuthContext;
  readonly evidenceId: string;
}

export interface DeleteEvidenceDeps {
  readonly evidence: EvidenceRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * DELETE /evidence/:id — logical (soft) delete. Role-gated to SUPERVISOR|ADMIN.
 * Marks `deletedAt = now` so the evidence is hidden from reads/lists without
 * dropping the row (referential integrity, sha256 chain-of-custody preserved).
 * Idempotent: re-deleting an already-deleted row is a no-op (no timeline/audit
 * noise). Records EVIDENCE_DELETED timeline + DELETE_EVIDENCE audit.
 * Scope: evidence, case_timeline, audit_logs.
 */
export function createDeleteEvidenceUseCase(deps: DeleteEvidenceDeps) {
  return async function deleteEvidence(input: DeleteEvidenceInput): Promise<Evidence> {
    requireRole(input.auth, DELETE_EVIDENCE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const evidenceId = createEvidenceId(input.evidenceId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.evidence.findById(evidenceId, tx);
      if (existing === null) {
        throw evidenceNotFound(evidenceId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('evidence does not belong to the actor organization');
      }
      if (existing.deletedAt !== null) {
        return existing;
      }

      const now = deps.clock.now();
      const deleted = existing.softDelete(now);
      await deps.evidence.save(deleted, tx);

      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId: deleted.caseId,
          eventType: 'EVIDENCE_DELETED',
          previousValue: deleted.id,
          newValue: null,
          createdBy: input.auth.userId,
          createdAt: now,
        }),
        tx,
      );

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'DELETE_EVIDENCE',
          resource: 'evidence',
          resourceId: deleted.id,
          detail: { caseId: deleted.caseId, filename: deleted.filename },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return deleted;
    });
  };
}

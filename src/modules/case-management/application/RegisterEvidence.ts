import { createHash } from 'node:crypto';
import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Evidence } from '../domain/model/aggregates/Evidence.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import type { EvidenceRepository } from '../domain/ports/EvidenceRepository.js';
import type { EvidenceStore } from '../domain/ports/EvidenceStore.js';
import type { TimestampAuthority } from '../domain/ports/TimestampAuthority.js';
import type { MalwareScanner } from '../domain/ports/MalwareScanner.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { EvidenceId } from '../domain/model/value-objects/EvidenceId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { Evidence as EvidenceAggregate } from '../domain/model/aggregates/Evidence.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { createInvestigationId } from '../domain/model/value-objects/InvestigationId.js';
import { assertAssigned } from '../domain/services/AssignmentGate.js';
import { assertNotClosed } from '../domain/services/ClosedCaseGate.js';
import { assertReviewStarted } from '../domain/services/WorkflowStepGate.js';
import {
  caseNotFound,
  forbiddenCrossTenant,
  investigationNotFound,
  evidenceInfected,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, CASE_WORK_ROLES } from './authorization/policy.js';

export interface RegisterEvidenceInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly investigationId?: string | null;
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Buffer;
}

export interface RegisterEvidenceDeps {
  readonly cases: CaseRepository;
  readonly investigations: InvestigationRepository;
  readonly evidence: EvidenceRepository;
  readonly evidenceStore: EvidenceStore;
  readonly timestampAuthority: TimestampAuthority;
  readonly malwareScanner: MalwareScanner;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateEvidenceId: () => EvidenceId;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * Registers an uploaded evidence blob: computes the SHA256 server-side, stores
 * the blob in the object store (outside Mongo, BEFORE the tx — a blob is not
 * transactional), requests an RFC3161 timestamp (null while deferred), then
 * persists the metadata + a REGISTER_EVIDENCE audit in one transaction. Any
 * authenticated tenant actor; the case (and optional investigation) must
 * belong to the actor's org.
 */
export function createRegisterEvidenceUseCase(deps: RegisterEvidenceDeps) {
  return async function registerEvidence(input: RegisterEvidenceInput): Promise<Evidence> {
    requireOperationalRole(input.auth, CASE_WORK_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    const kase = await deps.cases.findById(caseId);
    if (kase === null || kase.deletedAt !== null) {
      throw caseNotFound(caseId);
    }
    if (kase.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }
    // Without an assignee the case is frozen. See `AssignmentGate`.
    assertAssigned(kase);
    // A closed case is not worked. See `ClosedCaseGate`.
    assertNotClosed(kase);
    // Instruction comes after review. See `WorkflowStepGate`.
    assertReviewStarted(kase);

    let investigationId = null;
    if (input.investigationId !== undefined && input.investigationId !== null) {
      investigationId = createInvestigationId(input.investigationId);
      const investigation = await deps.investigations.findById(investigationId);
      if (
        investigation === null ||
        investigation.organizationId !== organizationId ||
        (investigation.caseId as string) !== (caseId as string)
      ) {
        throw investigationNotFound(investigationId);
      }
    }

    const evidenceId = deps.generateEvidenceId();
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const storageKey = `${organizationId}/${caseId}/${evidenceId}`;

    // INV-015: scan BEFORE touching the store. If the file is infected it is
    // not saved anywhere, so there is nothing to clean up afterwards — and no
    // copy of malware is left in the evidence bucket waiting for someone to
    // download it. The audit row for the rejection is still written: the
    // attempt itself is information.
    const verdict = await deps.malwareScanner.scan(input.bytes, input.filename);
    if (verdict.status === 'INFECTED') {
      await deps.auditRecorder.record({
        organizationId,
        actorType: input.auth.actorType,
        actorId: input.auth.userId,
        action: 'REGISTER_EVIDENCE',
        resource: 'evidence',
        resourceId: null,
        detail: {
          caseId,
          filename: input.filename,
          sha256,
          rejected: true,
          signature: verdict.signature,
        },
        ipAddress: input.auth.ipAddress,
      });
      throw evidenceInfected(input.filename, verdict.signature);
    }

    // Store the blob first — an object-store write is not part of the Mongo tx.
    await deps.evidenceStore.put(storageKey, input.bytes, input.contentType);
    const timestamp = await deps.timestampAuthority.requestTimestamp(sha256);

    const now = deps.clock.now();
    const evidence = EvidenceAggregate.register({
      id: evidenceId,
      caseId,
      investigationId,
      organizationId,
      filename: input.filename,
      contentType: input.contentType,
      byteSize: input.bytes.length,
      sha256,
      storageKey,
      timestamp,
      scanStatus: verdict.status,
      uploadedBy: input.auth.userId,
      now,
    });

    return deps.unitOfWork.withTransaction(async (tx) => {
      await deps.evidence.save(evidence, tx);

      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId,
          eventType: 'EVIDENCE_ADDED',
          previousValue: null,
          newValue: evidence.id,
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
          action: 'REGISTER_EVIDENCE',
          resource: 'evidence',
          resourceId: evidence.id,
          detail: {
            caseId,
            investigationId,
            filename: evidence.filename,
            sha256: evidence.sha256,
            byteSize: evidence.byteSize,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );
      return evidence;
    });
  };
}

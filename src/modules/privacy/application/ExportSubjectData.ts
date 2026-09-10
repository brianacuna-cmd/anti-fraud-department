import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { PrivacyDataRequestId } from '../domain/model/value-objects/PrivacyDataRequestId.js';
import type { PrivacyDataRequestRepository } from '../domain/ports/PrivacyDataRequestRepository.js';
import type { SubjectDataSource } from '../domain/ports/SubjectDataSource.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { privacyRequestNotFound } from '../domain/errors/PrivacyError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, PRIVACY_WRITE_ROLES } from './authorization/policy.js';

export interface ExportSubjectDataInput {
  readonly auth: AuthContext;
  readonly requestId: PrivacyDataRequestId;
}

/**
 * The package handed to the subject.
 *
 * Machine-readable and structured, because PORTABILITY (art. 20) requires a
 * "commonly used, machine-readable format" and ACCESS (art. 15) is satisfied
 * by the same thing. One shape serves both.
 */
export interface SubjectDataPackage {
  readonly requestId: string;
  readonly generatedAt: string;
  readonly subject: { readonly email: string; readonly customerId: string | null };
  readonly records: readonly {
    readonly kind: string;
    readonly id: string;
    readonly openedAt: string;
    readonly closedAt: string | null;
    readonly personalData: Readonly<Record<string, unknown>>;
    readonly retainedData: Readonly<Record<string, unknown>>;
    readonly retainedUntil: string | null;
    readonly retentionBasis: string | null;
  }[];
}

export interface ExportSubjectDataDeps {
  readonly requests: PrivacyDataRequestRepository;
  readonly subjectData: SubjectDataSource;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * PRIV-002: assembles every piece of personal data held about the subject.
 *
 * The package includes the RETAINED half as well as the identity half, and
 * that is not an oversight. Art. 15 gives the subject the right to know what
 * is held about them, including what is being kept and on what legal basis —
 * handing back only the fields the tenant is willing to delete would answer a
 * different question than the one asked.
 *
 * The whole thing is audited before it is returned, inside the transaction:
 * this is the single most sensitive operation in the module, and an export
 * that happened without a trace is indistinguishable from a data breach.
 */
export function createExportSubjectDataUseCase(deps: ExportSubjectDataDeps) {
  return async function exportSubjectData(
    input: ExportSubjectDataInput,
  ): Promise<SubjectDataPackage> {
    requireOperationalRole(input.auth, PRIVACY_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const request = await deps.requests.findById(input.requestId);
    if (request === null || request.organizationId !== organizationId) {
      throw privacyRequestNotFound(input.requestId);
    }

    const records = await deps.subjectData.findRecords(organizationId, {
      email: request.subjectEmail,
      customerId: request.subjectCustomerId,
    });

    const now = deps.clock.now();
    const pkg: SubjectDataPackage = {
      requestId: request.id,
      generatedAt: now,
      subject: { email: request.subjectEmail, customerId: request.subjectCustomerId },
      records: records.map((record) => ({
        kind: record.kind,
        id: record.id,
        openedAt: record.openedAt,
        closedAt: record.closedAt,
        personalData: record.personalData,
        retainedData: record.retainedData,
        retainedUntil: record.retainedUntil,
        retentionBasis: record.retentionBasis,
      })),
    };

    return deps.unitOfWork.withTransaction(async (tx) => {
      await deps.requests.save(request.start(now), tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'EXPORT_SUBJECT_DATA',
          resource: 'subject_data',
          resourceId: request.id,
          detail: {
            subjectEmail: request.subjectEmail,
            // Counts and ids, never the contents: an audit log that copies the
            // exported personal data becomes a second, permanent copy of
            // exactly what the subject may be asking to have deleted.
            recordCount: records.length,
            recordIds: records.map((r) => r.id),
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return pkg;
    });
  };
}

import type { Instant } from '../../../../../shared/time/Instant.js';
import type { CaseId } from '../value-objects/CaseId.js';
import type { InvestigationId } from '../value-objects/InvestigationId.js';
import type { EvidenceId } from '../value-objects/EvidenceId.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

/** RFC3161 timestamp over the evidence hash. Null until a TSA is wired (deferred seam). */
export interface EvidenceTimestamp {
  readonly token: string;
  readonly authority: string;
  readonly timestampedAt: Instant;
}

export interface EvidenceProps {
  readonly id: EvidenceId;
  readonly caseId: CaseId;
  readonly investigationId: InvestigationId | null;
  readonly organizationId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly timestamp: EvidenceTimestamp | null;
  readonly uploadedBy: string;
  readonly createdAt: Instant;
}

export interface RegisterEvidenceInput {
  readonly id: EvidenceId;
  readonly caseId: CaseId;
  readonly investigationId: InvestigationId | null;
  readonly organizationId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly timestamp: EvidenceTimestamp | null;
  readonly uploadedBy: string;
  readonly now: Instant;
}

/**
 * An uploaded evidence attachment. The BLOB lives in an object store (outside
 * Mongo); this aggregate holds only the metadata + the SHA256 integrity hash +
 * an optional RFC3161 timestamp (deferred until a TSA is wired). Immutable —
 * evidence is never edited (a correction is a new upload).
 */
export class Evidence {
  private constructor(private readonly props: EvidenceProps) {}

  static register(input: RegisterEvidenceInput): Evidence {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('filename', input.filename);
    assertNonEmpty('contentType', input.contentType);
    assertNonEmpty('sha256', input.sha256);
    assertNonEmpty('storageKey', input.storageKey);
    assertNonEmpty('uploadedBy', input.uploadedBy);
    if (input.byteSize <= 0) {
      throw invariantViolation('Evidence byteSize must be positive', { byteSize: input.byteSize });
    }
    return new Evidence({
      id: input.id,
      caseId: input.caseId,
      investigationId: input.investigationId,
      organizationId: input.organizationId,
      filename: input.filename,
      contentType: input.contentType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      storageKey: input.storageKey,
      timestamp: input.timestamp,
      uploadedBy: input.uploadedBy,
      createdAt: input.now,
    });
  }

  static rehydrate(props: EvidenceProps): Evidence {
    return new Evidence(props);
  }

  get id(): EvidenceId {
    return this.props.id;
  }

  get caseId(): CaseId {
    return this.props.caseId;
  }

  get investigationId(): InvestigationId | null {
    return this.props.investigationId;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get filename(): string {
    return this.props.filename;
  }

  get contentType(): string {
    return this.props.contentType;
  }

  get byteSize(): number {
    return this.props.byteSize;
  }

  get sha256(): string {
    return this.props.sha256;
  }

  get storageKey(): string {
    return this.props.storageKey;
  }

  get timestamp(): EvidenceTimestamp | null {
    return this.props.timestamp;
  }

  get uploadedBy(): string {
    return this.props.uploadedBy;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`Evidence ${field} must be a non-empty string`, { field, value });
  }
}

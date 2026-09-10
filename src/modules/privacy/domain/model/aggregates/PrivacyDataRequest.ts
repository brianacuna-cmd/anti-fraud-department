import type { Instant } from '../../../../../shared/time/Instant.js';
import { fromDate, toDate } from '../../../../../shared/time/Instant.js';
import type { PrivacyDataRequestId } from '../value-objects/PrivacyDataRequestId.js';
import type { PrivacyRequestType } from '../value-objects/PrivacyRequestType.js';
import type {
  PrivacyRequestStatus,
  PrivacyResolution,
} from '../value-objects/PrivacyRequestStatus.js';
import { isTerminal } from '../value-objects/PrivacyRequestStatus.js';
import { invalidTransition, invariantViolation } from '../../errors/PrivacyError.js';

/**
 * Legal deadline to answer a data-subject request, in days.
 *
 * One month under GDPR art. 12(3). Thirty days is the conservative reading of
 * "one month" — a request received on the 31st of January has no 31st of
 * February to land on, and counting days instead of months removes the whole
 * question. Erring short costs nothing; erring long is a breach.
 */
export const RESPONSE_DEADLINE_DAYS = 30;

export interface PrivacyDataRequestProps {
  readonly id: PrivacyDataRequestId;
  readonly organizationId: string;
  /**
   * Who is asking, identified by the email the tenant holds them under.
   *
   * Email and not an internal id on purpose: the subject writes in from
   * outside and knows their address, not the customer id some provider
   * assigned them. `subjectCustomerId` narrows it further WHEN the tenant can
   * establish it — and until it can, the request is still valid and still on
   * the clock.
   */
  readonly subjectEmail: string;
  readonly subjectCustomerId: string | null;
  readonly type: PrivacyRequestType;
  readonly status: PrivacyRequestStatus;
  readonly requesterNote: string | null;
  readonly receivedAt: Instant;
  /** `receivedAt` + RESPONSE_DEADLINE_DAYS. Stored, not computed on read — see `create`. */
  readonly dueAt: Instant;
  readonly resolution: PrivacyResolution | null;
  readonly resolutionNote: string | null;
  /**
   * SHA-256 of the certificate handed to the subject (PRIV-004).
   *
   * The hash and not the document: the certificate can be re-rendered from
   * the request at any time, but its hash is what proves the copy the subject
   * holds is the copy that was issued.
   */
  readonly certificateHash: string | null;
  readonly resolvedBy: string | null;
  readonly resolvedAt: Instant | null;
  readonly createdBy: string;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreatePrivacyDataRequestInput {
  readonly id: PrivacyDataRequestId;
  readonly organizationId: string;
  readonly subjectEmail: string;
  readonly subjectCustomerId?: string | null;
  readonly type: PrivacyRequestType;
  readonly requesterNote?: string | null;
  readonly createdBy: string;
  readonly now: Instant;
}

/**
 * A data-subject rights request (PRIV-001 to PRIV-004).
 *
 * The aggregate owns the two facts that have to survive an audit: WHEN the
 * clock started, and HOW the tenant answered. Everything else about a privacy
 * request — which records were touched, what the export contained — is a
 * consequence recorded in the audit trail, not state of this aggregate.
 */
export class PrivacyDataRequest {
  private constructor(private readonly props: PrivacyDataRequestProps) {}

  static create(input: CreatePrivacyDataRequestInput): PrivacyDataRequest {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('createdBy', input.createdBy);
    assertEmail(input.subjectEmail);

    /*
     * The deadline is computed once, at reception, and stored.
     *
     * Deriving it on every read looks equivalent and is not: the deadline is
     * a fact about a request that already happened, and if the rule ever
     * changes — a different jurisdiction, a lawful extension — recomputing
     * would silently rewrite the deadline of every request ever received,
     * including the ones already answered against the old one.
     */
    const dueAt = addDays(input.now, RESPONSE_DEADLINE_DAYS);

    return new PrivacyDataRequest({
      id: input.id,
      organizationId: input.organizationId,
      subjectEmail: normalizeEmail(input.subjectEmail),
      subjectCustomerId: input.subjectCustomerId?.trim() || null,
      type: input.type,
      status: 'RECEIVED',
      requesterNote: input.requesterNote?.trim() || null,
      receivedAt: input.now,
      dueAt,
      resolution: null,
      resolutionNote: null,
      certificateHash: null,
      resolvedBy: null,
      resolvedAt: null,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: PrivacyDataRequestProps): PrivacyDataRequest {
    return new PrivacyDataRequest(props);
  }

  /**
   * Marks that somebody started working on it (PRIV-002/PRIV-003 do this).
   *
   * Idempotent: doing the work twice is normal — a subject can ask for both
   * an export and an erasure under one request — and each pass should not
   * have to check the status first.
   */
  start(now: Instant): PrivacyDataRequest {
    if (this.props.status === 'IN_PROGRESS') return this;
    if (isTerminal(this.props.status)) {
      throw invalidTransition(this.props.status, 'IN_PROGRESS', this.props.id);
    }
    return new PrivacyDataRequest({ ...this.props, status: 'IN_PROGRESS', updatedAt: now });
  }

  /**
   * PRIV-004: the tenant's formal answer.
   *
   * A resolution note is REQUIRED, not optional. Under GDPR art. 12(4) a
   * controller that does not act has to say why, and in practice the same
   * applies to a partial fulfilment: "we kept your transaction history
   * because antilaundering law requires it for five years" is the sentence
   * that makes the outcome lawful. An empty note turns a defensible decision
   * into an unexplained one.
   */
  resolve(input: {
    readonly resolution: PrivacyResolution;
    readonly note: string;
    readonly certificateHash: string;
    readonly resolvedBy: string;
    readonly now: Instant;
  }): PrivacyDataRequest {
    if (isTerminal(this.props.status)) {
      throw invalidTransition(this.props.status, 'COMPLETED', this.props.id);
    }
    assertNonEmpty('resolvedBy', input.resolvedBy);
    if (input.note.trim().length === 0) {
      throw invariantViolation('a privacy request cannot be resolved without stating why', {
        id: this.props.id,
        resolution: input.resolution,
      });
    }
    assertNonEmpty('certificateHash', input.certificateHash);

    return new PrivacyDataRequest({
      ...this.props,
      status: input.resolution === 'REJECTED' ? 'REJECTED' : 'COMPLETED',
      resolution: input.resolution,
      resolutionNote: input.note.trim(),
      certificateHash: input.certificateHash,
      resolvedBy: input.resolvedBy,
      resolvedAt: input.now,
      updatedAt: input.now,
    });
  }

  /** True once the legal deadline has passed without a resolution. */
  isOverdue(now: Instant): boolean {
    if (isTerminal(this.props.status)) return false;
    return toDate(now).getTime() > toDate(this.props.dueAt).getTime();
  }

  get id(): PrivacyDataRequestId {
    return this.props.id;
  }
  get organizationId(): string {
    return this.props.organizationId;
  }
  get subjectEmail(): string {
    return this.props.subjectEmail;
  }
  get subjectCustomerId(): string | null {
    return this.props.subjectCustomerId;
  }
  get type(): PrivacyRequestType {
    return this.props.type;
  }
  get status(): PrivacyRequestStatus {
    return this.props.status;
  }
  get requesterNote(): string | null {
    return this.props.requesterNote;
  }
  get receivedAt(): Instant {
    return this.props.receivedAt;
  }
  get dueAt(): Instant {
    return this.props.dueAt;
  }
  get resolution(): PrivacyResolution | null {
    return this.props.resolution;
  }
  get resolutionNote(): string | null {
    return this.props.resolutionNote;
  }
  get certificateHash(): string | null {
    return this.props.certificateHash;
  }
  get resolvedBy(): string | null {
    return this.props.resolvedBy;
  }
  get resolvedAt(): Instant | null {
    return this.props.resolvedAt;
  }
  get createdBy(): string {
    return this.props.createdBy;
  }
  get createdAt(): Instant {
    return this.props.createdAt;
  }
  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  /** Full props, for the persistence mapper only. */
  toProps(): PrivacyDataRequestProps {
    return this.props;
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`PrivacyDataRequest ${field} must be a non-empty string`, { field });
  }
}

/**
 * Deliberately loose: one `@`, something either side, no spaces.
 *
 * A stricter pattern would reject addresses that are legal under RFC 5322 and
 * that real people actually hold, and rejecting a data-subject request over a
 * plus sign or a quoted local part is a compliance failure, not a validation
 * win. The check exists to catch an empty field or a pasted sentence.
 */
function assertEmail(value: string): void {
  const trimmed = value.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(trimmed)) {
    throw invariantViolation('PrivacyDataRequest subjectEmail must look like an email address', {
      subjectEmail: value,
    });
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function addDays(instant: Instant, days: number): Instant {
  const date = new Date(toDate(instant).getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return fromDate(date);
}

import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Who the request is about, as far as the tenant can pin them down.
 *
 * Both fields are matched with OR, not AND: a subject writes in with an email
 * and the tenant may or may not have resolved it to a customer id. Requiring
 * both would mean the requests hardest to link are the ones silently answered
 * with "we hold nothing about you" — the worst possible failure mode here.
 */
export interface SubjectSelector {
  readonly email: string;
  readonly customerId: string | null;
}

/**
 * One record held about the subject, already split into the two halves that
 * the law treats differently.
 *
 * The split is the whole point of this port. An erasure request does not
 * delete a record: it removes what IDENTIFIES the person while keeping what
 * the tenant is obliged to retain. Handing the privacy module an opaque blob
 * would force it to guess which fields are which, and guessing wrong means
 * either leaking identity or destroying an antilaundering trail.
 */
export interface SubjectRecord {
  /** Which store it came from. Only `case` today; SAR reports will follow. */
  readonly kind: 'case';
  readonly id: string;
  readonly openedAt: Instant;
  readonly closedAt: Instant | null;
  /**
   * When the retention duty on this record expires, or `null` when none
   * applies.
   *
   * Computed by the adapter, not here: how long a record must be kept depends
   * on the tenant's jurisdiction and configuration, which the privacy domain
   * has no business knowing. What the domain decides is what to DO about it.
   */
  readonly retainedUntil: Instant | null;
  /** The legal duty being invoked, for the answer the subject is owed. */
  readonly retentionBasis: string | null;
  /** Identity fields: what an erasure removes and an export hands back. */
  readonly personalData: Readonly<Record<string, unknown>>;
  /** Financial and decision fields: what survives an erasure. */
  readonly retainedData: Readonly<Record<string, unknown>>;
}

/**
 * Narrow cross-module port — same pattern as `sar`'s `SarSourceVerifier`.
 * `privacy`'s domain never imports `case-management`'s domain directly; the
 * composition root implements this by wrapping the real repositories.
 */
export interface SubjectDataSource {
  /** Every record held about the subject in this organization. */
  findRecords(organizationId: string, subject: SubjectSelector): Promise<readonly SubjectRecord[]>;

  /**
   * Masks the identity fields of the named records, leaving everything else
   * untouched. Returns how many were actually changed.
   *
   * Takes ids and not a selector on purpose: WHICH records may be masked is a
   * decision the privacy domain already made (see `RetentionPolicy`), and an
   * adapter that re-ran the selector could mask a record the domain had just
   * ruled out.
   */
  maskRecords(
    organizationId: string,
    recordIds: readonly string[],
    tx?: Transaction,
  ): Promise<number>;
}

import type { Instant } from '../../../../shared/time/Instant.js';
import { toDate } from '../../../../shared/time/Instant.js';
import type { SubjectRecord } from '../ports/SubjectDataSource.js';

export interface ErasurePlan {
  /** Records whose identity fields may be masked now. */
  readonly erasable: readonly SubjectRecord[];
  /** Records a legal duty forces the tenant to keep intact, with the reason. */
  readonly barred: readonly SubjectRecord[];
  /**
   * The latest date any barred record stays barred, or `null` when nothing is
   * barred. This is the date the subject is told to come back on.
   */
  readonly barredUntil: Instant | null;
  /** Distinct legal bases invoked, for the answer the subject is owed. */
  readonly bases: readonly string[];
}

/**
 * Decides what an erasure request may actually erase.
 *
 * This is the one rule the whole module exists to get right. GDPR art. 17(1)
 * gives a subject the right to have their data deleted; art. 17(3)(b) removes
 * that right where processing is necessary to comply with a legal obligation
 * — and antilaundering law is exactly such an obligation, with retention
 * windows measured in years.
 *
 * So the answer to "delete everything about me" is almost never yes or no. It
 * is: the identity fields go, the financial trail stays until its retention
 * expires, and the subject is told which records, on what basis, and until
 * when. That is what this function computes.
 *
 * It deliberately does NOT decide the retention window itself — the adapter
 * supplies `retainedUntil` per record, because the window depends on the
 * tenant's jurisdiction. What is universal, and therefore lives here, is the
 * arithmetic of comparing it to today and the shape of the answer.
 */
export function planErasure(records: readonly SubjectRecord[], now: Instant): ErasurePlan {
  const nowMs = toDate(now).getTime();

  /*
   * A null `retainedUntil` means NO duty, not "unknown".
   *
   * The adapter is the only thing that can know whether a duty applies, so a
   * null here is an answer it gave, not a gap. Treating it as unknown and
   * refusing to erase would quietly turn every erasure into a refusal.
   */
  const isErasable = (record: SubjectRecord): boolean =>
    record.retainedUntil === null || toDate(record.retainedUntil).getTime() <= nowMs;

  const erasable = records.filter(isErasable);
  const barred = records.filter((record) => !isErasable(record));

  const barredUntil = barred.reduce<Instant | null>((latest, record) => {
    if (record.retainedUntil === null) return latest;
    if (latest === null) return record.retainedUntil;
    return toDate(record.retainedUntil).getTime() > toDate(latest).getTime()
      ? record.retainedUntil
      : latest;
  }, null);

  const bases = [
    ...new Set(barred.map((r) => r.retentionBasis).filter((b): b is string => b !== null)),
  ];

  return { erasable, barred, barredUntil, bases };
}

/**
 * How the outcome should be reported back to the subject.
 *
 * `PARTIALLY_FULFILLED` when anything at all was kept: claiming a full
 * erasure while a retained record still names the person is the one answer
 * that is both untrue and easy to disprove.
 */
export function resolutionFor(plan: ErasurePlan): 'FULFILLED' | 'PARTIALLY_FULFILLED' {
  return plan.barred.length === 0 ? 'FULFILLED' : 'PARTIALLY_FULFILLED';
}

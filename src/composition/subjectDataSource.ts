import { ObjectId, type ClientSession, type Db, type Filter } from 'mongodb';
import { fromDate } from '../shared/time/Instant.js';
import type {
  SubjectDataSource,
  SubjectRecord,
  SubjectSelector,
} from '../modules/privacy/domain/ports/SubjectDataSource.js';
import type { Transaction } from '../modules/privacy/domain/ports/UnitOfWork.js';

/**
 * How long an antilaundering record must be kept, in years, counted from the
 * case being closed.
 *
 * Five years is the floor set by FATF Recommendation 11 and by the EU AML
 * directives, and Latin-American UIF regimes land on the same number. It is
 * a constant here rather than tenant configuration because getting it wrong
 * downward is a regulatory breach: a tenant should not be able to shorten it
 * from a settings screen. Lengthening it per jurisdiction is the change this
 * would grow into, and that belongs in `organization_fraud_config`.
 */
const AML_RETENTION_YEARS = 5;

const RETENTION_BASIS = `Retención antilavado (${AML_RETENTION_YEARS} años desde el cierre del expediente)`;

/** Value written over an identity field once erased. Recognizable, not blank. */
const MASK = '[ANONIMIZADO]';

interface CaseRow {
  readonly _id: ObjectId;
  readonly customer_id: string;
  readonly customer_email: string | null;
  readonly bridge_user_id: string | null;
  readonly bridge_wallet: string | null;
  readonly stripe_customer_id: string | null;
  readonly finturu_cache_snapshot: Record<string, unknown> | null;
  readonly risk_score: number;
  readonly status: string;
  readonly priority: string;
  readonly tags: readonly string[];
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly due_date: Date | null;
}

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

/** A case is closed once it reaches one of these; retention counts from there. */
const CLOSED_STATUSES = new Set(['RESOLVED', 'ARCHIVED']);

/** Sentinel for "open case, clock not started". Never rendered as a real date. */
const FAR_FUTURE = new Date('9999-12-31T00:00:00.000Z');

function retainedUntil(row: CaseRow): Date | null {
  /*
   * An OPEN case has no retention expiry yet — and that is not the same as
   * "no duty". It is a stronger duty: an investigation in progress cannot be
   * stripped of the identity it is investigating. Returning a far-future date
   * would be a lie about the calendar; what is true is that the clock has not
   * started, so nothing can be erased yet.
   */
  if (!CLOSED_STATUSES.has(row.status)) return FAR_FUTURE;

  const closedAt = row.updated_at;
  const until = new Date(closedAt.getTime());
  until.setUTCFullYear(until.getUTCFullYear() + AML_RETENTION_YEARS);
  return until;
}

/**
 * Composition-root implementation of `privacy`'s `SubjectDataSource` port —
 * same pattern as `sarSourceVerifier.ts`: the narrow port lives in the new
 * module's domain and THIS file, the one legal seam for a cross-module
 * import, wires it to real storage.
 *
 * It reads and writes the `cases` collection directly rather than going
 * through `CaseRepository`. That is deliberate and narrow: masking is a
 * field-level surgical update on a document, not a domain operation any case
 * use case should ever expose. Handing `case-management` a `maskIdentity()`
 * method would put a way to destroy identity data on an aggregate that a
 * hundred other call sites can reach.
 */
export function createSubjectDataSource(db: Db): SubjectDataSource {
  const cases = db.collection<CaseRow>('cases');

  function filterFor(organizationId: string, subject: SubjectSelector): Filter<CaseRow> {
    /*
     * Email OR customer id, never AND.
     *
     * A subject writes in with an address; the tenant may or may not have
     * resolved it to an internal id. Requiring both would make the requests
     * hardest to link the ones silently answered "we hold nothing about you".
     */
    const identifiers: Filter<CaseRow>[] = [{ customer_email: subject.email }];
    if (subject.customerId !== null) identifiers.push({ customer_id: subject.customerId });

    return {
      organization_id: new ObjectId(organizationId),
      $or: identifiers,
    } as Filter<CaseRow>;
  }

  return {
    async findRecords(organizationId, subject): Promise<readonly SubjectRecord[]> {
      const rows = await cases.find(filterFor(organizationId, subject)).toArray();

      return rows.map((row): SubjectRecord => {
        const until = retainedUntil(row);
        const closed = CLOSED_STATUSES.has(row.status) ? fromDate(row.updated_at) : null;

        return {
          kind: 'case',
          id: row._id.toHexString(),
          openedAt: fromDate(row.created_at),
          closedAt: closed,
          retainedUntil: until === null ? null : fromDate(until),
          retentionBasis: until === null ? null : RETENTION_BASIS,

          // What identifies the person. This is what an erasure removes.
          personalData: {
            customerId: row.customer_id,
            customerEmail: row.customer_email,
            bridgeUserId: row.bridge_user_id,
            bridgeWallet: row.bridge_wallet,
            stripeCustomerId: row.stripe_customer_id,
            snapshot: row.finturu_cache_snapshot,
          },

          // What the antilaundering duty is about. This survives an erasure:
          // it says a case existed, how it was scored and how it ended,
          // without saying who it was about.
          retainedData: {
            riskScore: row.risk_score,
            status: row.status,
            priority: row.priority,
            tags: [...row.tags],
            dueDate: row.due_date === null ? null : fromDate(row.due_date),
          },
        };
      });
    },

    async maskRecords(organizationId, recordIds, tx): Promise<number> {
      if (recordIds.length === 0) return 0;

      const result = await cases.updateMany(
        {
          organization_id: new ObjectId(organizationId),
          _id: { $in: recordIds.map((id) => new ObjectId(id)) },
        } as Filter<CaseRow>,
        {
          $set: {
            // The provider's customer id identifies the person just as much as
            // the email does — it is the key their whole file hangs from.
            customer_id: MASK,
            customer_email: MASK,
            bridge_user_id: null,
            bridge_wallet: null,
            stripe_customer_id: null,
            /*
             * The frozen provider snapshot goes entirely.
             *
             * It is a verbatim copy of what Bridge/Stripe returned about the
             * person — names, addresses, phone numbers, device fingerprints —
             * in a shape this system never modeled and therefore cannot mask
             * field by field. Anything short of dropping it would leave
             * identity data behind in a blob nobody audits.
             */
            finturu_cache_snapshot: null,
            /*
             * `updated_at` is deliberately NOT touched.
             *
             * Retention is counted from it — see `retainedUntil` — so bumping
             * it here would push every masked record's expiry five years into
             * the future, on the very operation whose point is to hold less
             * data for less time. The change is recorded in the audit trail,
             * which is where an erasure belongs anyway; the row's own
             * timestamp has to keep meaning "when the case last moved".
             */
          },
        },
        { session: toSession(tx) },
      );

      return result.modifiedCount;
    },
  };
}

import { createHash } from 'node:crypto';
import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import { fromDate, type Instant } from '../../../shared/time/Instant.js';
import { classifyStripeDecline } from '../../../shared/payments/stripeDeclineClassification.js';
import { PaymentActivity } from '../domain/model/aggregates/PaymentActivity.js';
import type { PaymentActivityId } from '../domain/model/value-objects/PaymentActivityId.js';
import type { PaymentActivityRepository } from '../domain/ports/PaymentActivityRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import { invariantViolation } from '../domain/errors/RiskAssessmentError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SCORING_RULE_WRITE_ROLES } from './authorization/policy.js';

/** One CSV record keyed by header. */
export type PaymentActivityCsvRow = Readonly<Record<string, string | undefined>>;

export interface ImportPaymentActivitiesInput {
  readonly auth: AuthContext;
  readonly rows: readonly PaymentActivityCsvRow[];
  /** Original file name, for the audit trail only. */
  readonly fileName?: string;
}

export interface ImportRowError {
  /** 1-based line in the file, header included (the first data row is line 2). */
  readonly line: number;
  readonly reason: string;
}

export interface ImportPaymentActivitiesResult {
  readonly rowsRead: number;
  readonly inserted: number;
  /** Already imported (same provider event): re-importing a file is safe. */
  readonly duplicates: number;
  readonly rejected: number;
  /** First `MAX_REPORTED_ERRORS` problems, so a broken file does not produce a megabyte of errors. */
  readonly errors: readonly ImportRowError[];
}

export interface ImportPaymentActivitiesDeps {
  readonly activities: PaymentActivityRepository;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
  readonly generatePaymentActivityId: () => PaymentActivityId;
}

export const MAX_IMPORT_ROWS = 20_000;
const MAX_REPORTED_ERRORS = 100;

/** Columns of the import file. Only the first six are required. */
export const PAYMENT_ACTIVITY_CSV_COLUMNS = [
  'provider',
  'customer_id',
  'kind',
  'amount',
  'currency',
  'occurred_at',
  'outcome',
  'provider_event_id',
  'provider_reference',
  'related_references',
  'merchant_id',
  'event_type',
  'decline_code',
  'decline_category',
  'card_country',
  'billing_country',
] as const;

/**
 * Loads provider transactions exported as CSV (a Stripe or Coinflow export, a
 * Finturu extract) into the customer payment history — the same store the
 * webhooks feed. It is how history from before the webhooks, or from a
 * provider without webhooks, reaches the rule variables, merchant risk and
 * payment link reconciliation.
 *
 * It only RECORDS: nothing is scored and no case is opened. Scoring a year of
 * imported payments would flood the inbox with cases about the past.
 *
 * SUPERVISOR only. Row by row: a bad row is reported with its line and the
 * rest still load. Idempotent: without `provider_event_id` the row gets a
 * deterministic id from its content, so importing the same file twice inserts
 * nothing the second time.
 */
export function createImportPaymentActivitiesUseCase(deps: ImportPaymentActivitiesDeps) {
  return async function importPaymentActivities(
    input: ImportPaymentActivitiesInput,
  ): Promise<ImportPaymentActivitiesResult> {
    requireOperationalRole(input.auth, SCORING_RULE_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    if (input.rows.length > MAX_IMPORT_ROWS) {
      throw invariantViolation(`the file has ${input.rows.length} rows; the limit per import is ${MAX_IMPORT_ROWS}`, {
        rows: input.rows.length,
      });
    }

    const now = deps.clock.now();
    const errors: ImportRowError[] = [];
    let inserted = 0;
    let duplicates = 0;
    let rejected = 0;

    for (const [index, row] of input.rows.entries()) {
      const line = index + 2;
      try {
        const activity = toActivity(deps, organizationId, row, now);
        const outcome = await deps.activities.record(activity);
        if (outcome === 'inserted') inserted += 1;
        else duplicates += 1;
      } catch (error) {
        rejected += 1;
        if (errors.length < MAX_REPORTED_ERRORS) {
          errors.push({ line, reason: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    const result = { rowsRead: input.rows.length, inserted, duplicates, rejected, errors };
    await deps.auditRecorder.record({
      organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId,
      action: 'IMPORT_PAYMENT_ACTIVITIES',
      resource: 'payment_activity',
      resourceId: null,
      detail: { fileName: input.fileName ?? null, rowsRead: result.rowsRead, inserted, duplicates, rejected },
      ipAddress: input.auth.ipAddress,
    });
    return result;
  };
}

function toActivity(
  deps: ImportPaymentActivitiesDeps,
  organizationId: string,
  row: PaymentActivityCsvRow,
  now: Instant,
): PaymentActivity {
  const provider = required(row, 'provider').toLowerCase();
  const kind = required(row, 'kind').toUpperCase();
  const currency = required(row, 'currency');
  const amountCents = parseAmountCents(required(row, 'amount'));
  const occurredAt = parseInstant(required(row, 'occurred_at'));
  const declineCode = optional(row, 'decline_code');
  const declineCategory =
    optional(row, 'decline_category')?.toUpperCase() ??
    (declineCode !== null ? classifyStripeDecline([declineCode])?.category ?? null : null);
  const related = optional(row, 'related_references');

  return PaymentActivity.create({
    id: deps.generatePaymentActivityId(),
    organizationId,
    customerId: required(row, 'customer_id'),
    provider,
    providerEventId: optional(row, 'provider_event_id') ?? contentId(row),
    providerReference: optional(row, 'provider_reference'),
    relatedReferences: related === null ? [] : related.split('|').map((r) => r.trim()),
    merchantId: optional(row, 'merchant_id'),
    providerEventType: optional(row, 'event_type') ?? `csv.${kind.toLowerCase()}`,
    kind,
    outcome: optional(row, 'outcome')?.toUpperCase() ?? null,
    amountCents,
    currency,
    declineCategory,
    cardCountry: optional(row, 'card_country'),
    billingCountry: optional(row, 'billing_country'),
    source: 'CSV_IMPORT',
    occurredAt,
    recordedAt: now,
  });
}

function required(row: PaymentActivityCsvRow, column: string): string {
  const value = optional(row, column);
  if (value === null) {
    throw new Error(`missing column "${column}"`);
  }
  return value;
}

function optional(row: PaymentActivityCsvRow, column: string): string | null {
  const value = row[column]?.trim();
  return value ? value : null;
}

/** Major units with a dot (`12.50`), like provider exports; never a thousands separator. */
function parseAmountCents(raw: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error(`amount "${raw}" must be a number with up to two decimals and a dot separator`);
  }
  return Math.round(Number(raw) * 100);
}

function parseInstant(raw: string): Instant {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    throw new Error(`occurred_at "${raw}" must be an ISO 8601 date`);
  }
  return fromDate(date);
}

/**
 * Deterministic id for rows without `provider_event_id`: the same content
 * always yields the same id, which is what makes re-imports idempotent.
 */
function contentId(row: PaymentActivityCsvRow): string {
  const canonical = PAYMENT_ACTIVITY_CSV_COLUMNS.map((column) => `${column}=${row[column]?.trim() ?? ''}`).join('\n');
  return `csv:${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`;
}

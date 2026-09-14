import { Router, type Response } from 'express';
import { requireAuthContext } from '../shared/http/requestAuthContext.js';
import type { AuthContext } from '../shared/kernel/AuthContext.js';
import type { Clock } from '../shared/time/Clock.js';
import { fromDate, type Instant } from '../shared/time/Instant.js';
import { requireReadRole, MERCHANT_READ_ROLES } from '../modules/risk-assessment/application/authorization/policy.js';
import { requireTenantContext } from '../modules/risk-assessment/application/authorization/requireTenantContext.js';
import { invariantViolation } from '../modules/risk-assessment/domain/errors/RiskAssessmentError.js';
import { assessMerchantRisk } from '../modules/risk-assessment/domain/model/MerchantRisk.js';
import {
  reconcilePaymentLinks,
  type ReconciliationReport,
} from '../modules/risk-assessment/domain/model/PaymentLinkReconciliation.js';
import type { PaymentActivityRepository } from '../modules/risk-assessment/domain/ports/PaymentActivityRepository.js';
import type { createGetCustomerCaseHistoryUseCase } from '../modules/case-management/application/GetCustomerCaseHistory.js';
import {
  FinturuUnavailableError,
  type FinturuApiClient,
  type FinturuMerchantDto,
  type FinturuPaymentLinkDto,
} from '../modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';

/** The part of the Finturu client these routes read (lets tests fake it). */
export type FinturuMerchantSource = Pick<FinturuApiClient, 'listMerchants' | 'getMerchant' | 'listPaymentLinks'>;

export interface MerchantRiskRouterDeps {
  readonly finturu: FinturuMerchantSource;
  readonly activities: PaymentActivityRepository;
  readonly getCustomerCaseHistory: ReturnType<typeof createGetCustomerCaseHistoryUseCase>;
  readonly clock: Clock;
}

const MERCHANT_PAGE_MAX = 50;
const LINK_PAGE = 500;
/** Beyond this the period is too wide for a synchronous report: narrow it. */
export const RECONCILIATION_MAX_LINKS = 10_000;
const REFERENCE_CHUNK = 1_000;

/**
 * Composition HTTP seam for Finturu merchant data:
 *
 * - `GET /merchants`, `GET /merchants/:userId`: Finturu merchants with an
 *   explainable risk assessment (link figures from Finturu, received payments
 *   from the payment history, earlier cases).
 * - `GET /merchants/:userId/payment-links`: that merchant's links.
 * - `GET /reconciliation/payment-links`: Finturu links of a period crossed with
 *   what the providers reported; `format=csv` downloads it.
 *
 * Finturu failures answer 502 instead of an empty result: an empty merchant
 * list or reconciliation would look like real data.
 */
export function merchantRiskRouter(deps: MerchantRiskRouterDeps): Router {
  const router = Router();

  router.get('/merchants', async (req, res) => {
    const auth = authorize(requireAuthContext(req));
    const limit = Math.min(MERCHANT_PAGE_MAX, Math.max(1, Number(req.query.limit) || 25));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    await withFinturu(res, async () => {
      const page = await deps.finturu.listMerchants(limit, offset, search);
      const now = deps.clock.now();
      const items = await Promise.all(page.items.map((merchant) => withRisk(deps, auth, merchant, now)));
      return { items, total: page.total };
    });
  });

  router.get('/merchants/:userId', async (req, res) => {
    const auth = authorize(requireAuthContext(req));
    const userId = parseUserId(req.params.userId);

    await withFinturu(res, async () => {
      const merchant = await deps.finturu.getMerchant(userId);
      if (merchant === null) {
        return { status: 404, body: { error: { code: 'MERCHANT_NOT_FOUND', message: `no merchant ${userId}`, metadata: {} } } };
      }
      return withRisk(deps, auth, merchant, deps.clock.now());
    });
  });

  router.get('/merchants/:userId/payment-links', async (req, res) => {
    authorize(requireAuthContext(req));
    const userId = parseUserId(req.params.userId);
    await withFinturu(res, () =>
      deps.finturu.listPaymentLinks({
        userId,
        limit: Math.min(LINK_PAGE, Math.max(1, Number(req.query.limit) || 25)),
        offset: Math.max(0, Number(req.query.offset) || 0),
      }),
    );
  });

  router.get('/reconciliation/payment-links', async (req, res) => {
    const auth = authorize(requireAuthContext(req));
    const organizationId = requireTenantContext(auth);
    const from = parseDay('from', req.query.from);
    const to = parseDay('to', req.query.to);
    if (new Date(from) >= new Date(to)) {
      throw invariantViolation('"from" must be before "to"');
    }
    const userId = req.query.userId === undefined ? undefined : parseUserId(req.query.userId);

    await withFinturu(res, async () => {
      const links = await loadLinks(deps.finturu, { from, to, userId });
      if (links === 'TOO_MANY') {
        throw invariantViolation(
          `the period has more than ${RECONCILIATION_MAX_LINKS} payment links; narrow the dates or filter by merchant`,
        );
      }
      const references = [...new Set(links.map((l) => l.providerPaymentId).filter((r): r is string => r !== null))];
      const activities = await loadActivities(deps.activities, organizationId, references);
      const report = reconcilePaymentLinks(
        links.map((l) => ({
          id: l.id,
          merchantUserId: l.userId,
          amount: l.amount,
          shippingAmount: l.shippingAmount ?? 0,
          state: l.state,
          isPaid: l.isPaid,
          provider: l.provider,
          providerPaymentId: l.providerPaymentId,
          refundAmount: l.refundAmount,
          createdAt: l.createdAt,
        })),
        activities,
      );

      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="conciliacion-${from.slice(0, 10)}-${to.slice(0, 10)}.csv"`);
        return { raw: toCsv(report) };
      }
      return { from, to, userId: userId ?? null, ...report };
    });
  });

  return router;
}

function authorize(auth: AuthContext): AuthContext {
  requireReadRole(auth, MERCHANT_READ_ROLES);
  requireTenantContext(auth);
  return auth;
}

async function withRisk(deps: MerchantRiskRouterDeps, auth: AuthContext, merchant: FinturuMerchantDto, now: Instant) {
  const organizationId = requireTenantContext(auth);
  const merchantIds = [String(merchant.userId), merchant.stripeAccountId].filter((id): id is string => !!id);
  const [activity, cases] = await Promise.all([
    deps.activities.summarizeMerchant(organizationId, merchantIds, now),
    deps.getCustomerCaseHistory({ auth, customerId: String(merchant.userId) }),
  ]);
  const risk = assessMerchantRisk({
    links: merchant.links,
    activity,
    cases,
    merchantSince: merchant.createdAt ? fromDate(new Date(merchant.createdAt)) : null,
    now,
  });
  return { ...merchant, activity, cases, risk };
}

type HandlerResult = unknown | { status: number; body: unknown } | { raw: string };

/** Runs a Finturu-backed handler: 502 when Finturu fails, raw bodies for CSV, JSON otherwise. */
async function withFinturu(res: Response, work: () => Promise<HandlerResult>): Promise<void> {
  let result: HandlerResult;
  try {
    result = await work();
  } catch (error) {
    if (error instanceof FinturuUnavailableError) {
      res.status(502).json({
        error: { code: 'FINTURU_UNAVAILABLE', message: 'Finturu did not return the data; try again later', metadata: { status: error.status } },
      });
      return;
    }
    throw error;
  }
  if (isRecord(result) && typeof result.raw === 'string') {
    res.status(200).send(result.raw);
  } else if (isRecord(result) && typeof result.status === 'number' && 'body' in result) {
    res.status(result.status).json(result.body);
  } else {
    res.status(200).json(result);
  }
}

async function loadLinks(
  finturu: FinturuMerchantSource,
  query: { from: string; to: string; userId: number | undefined },
): Promise<FinturuPaymentLinkDto[] | 'TOO_MANY'> {
  const links: FinturuPaymentLinkDto[] = [];
  for (let offset = 0; ; offset += LINK_PAGE) {
    const page = await finturu.listPaymentLinks({ ...query, limit: LINK_PAGE, offset });
    if (page.total > RECONCILIATION_MAX_LINKS) return 'TOO_MANY';
    links.push(...page.items);
    if (page.items.length < LINK_PAGE || links.length >= page.total) return links;
  }
}

async function loadActivities(activities: PaymentActivityRepository, organizationId: string, references: string[]) {
  const rows = [];
  for (let i = 0; i < references.length; i += REFERENCE_CHUNK) {
    const found = await activities.findByReferences(organizationId, references.slice(i, i + REFERENCE_CHUNK));
    rows.push(...found.map((row) => row.toProps()));
  }
  // A row can match two chunks (charge id in one, PaymentIntent in another).
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function parseUserId(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw invariantViolation('userId must be a positive integer', { userId: raw });
  }
  return value;
}

/** `YYYY-MM-DD` or a full ISO date, normalized to an ISO instant. */
function parseDay(field: string, raw: unknown): string {
  const date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw) ? new Date(raw) : new Date(NaN);
  if (Number.isNaN(date.getTime())) {
    throw invariantViolation(`"${field}" must be a date (YYYY-MM-DD)`, { [field]: raw });
  }
  return date.toISOString();
}

const CSV_HEADER = [
  'link_id',
  'merchant_user_id',
  'status',
  'link_state',
  'link_paid',
  'provider',
  'provider_payment_id',
  'expected_amount_usd',
  'provider_amount_usd',
  'chargebacks',
  'link_created_at',
];

function toCsv(report: ReconciliationReport): string {
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = report.discrepancies.map((item) =>
    [
      item.linkId,
      item.merchantUserId,
      item.status,
      item.linkState,
      item.linkPaid,
      item.provider,
      item.providerPaymentId,
      (item.expectedAmountCents / 100).toFixed(2),
      item.providerAmountCents === null ? null : (item.providerAmountCents / 100).toFixed(2),
      item.chargebacks,
      item.linkCreatedAt,
    ]
      .map(cell)
      .join(','),
  );
  return [CSV_HEADER.join(','), ...lines].join('\n') + '\n';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

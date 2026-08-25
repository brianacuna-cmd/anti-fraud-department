import type { Clock } from '../../../shared/time/Clock.js';
import { ACTIVE_CASE_STATUSES } from '../domain/ports/CaseRepository.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { InitializeCaseSlaService } from './InitializeCaseSla.js';
import type { RouteCaseInput } from './RouteCase.js';
import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import type { CaseId } from '../domain/model/value-objects/CaseId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { invariantViolation } from '../domain/errors/CaseManagementError.js';
import { Case } from '../domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';
import { createRiskScore } from '../domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../domain/model/value-objects/CasePriority.js';

export interface IngestFinturuCaseInput {
  readonly rawPayload: Record<string, unknown>;
  readonly organizationId?: string;
  readonly defaultOrganizationId?: string;
  readonly ipAddress?: string;
  readonly recordTimeline?: boolean;
}

export interface IngestFinturuCaseDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly outbox: OutboxEventRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseId: () => CaseId;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly auditRecorder: AuditRecorder;
  readonly generateOutboxEventId: () => OutboxEventId;
  readonly initializeCaseSla: InitializeCaseSlaService;
  /**
   * CASE-002. This is the composed `RouteCase` use case (the same one
   * `CreateCase` receives), so the assignment, its `ASSIGNED` milestone, and
   * its audit row commit inside THIS transaction. Optional: without it, the
   * case is born unassigned and waits in the general inbox.
   */
  readonly routeCase?: (input: RouteCaseInput) => Promise<Case>;
}

export interface IngestFinturuCaseResult {
  readonly case: Case;
  readonly outboxEventId: string;
}

function extractString(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

/** The shape Mongo accepts as an ObjectId: 24 hexadecimal characters. */
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Resolves the tenant the case belongs to, or fails saying why.
 *
 * Previously, when none resolved, the literal `'finturu-org'` was invented.
 * After the migration to native ObjectId that blew up inside the driver with a
 * `BSONError` about hexadecimal strings: the webhook returned a 400 whose
 * message said nothing about the real problem, and the operator had no way to
 * know that what was missing was the organization.
 *
 * An identifier that is not an ObjectId —typically a slug, which the
 * extraction list allows— is rejected instead of falling through to the
 * default tenant: the payload designated a concrete tenant, and archiving its
 * fraud case under another would be a cross-tenant leak, far worse than a
 * rejected webhook.
 */
function requireTenantId(candidate: string | undefined): string {
  const value = candidate?.trim();

  if (!value) {
    throw invariantViolation(
      'Finturu ingestion resolved no organization: the payload carries none and no default was configured',
      { field: 'organizationId' },
    );
  }

  if (!OBJECT_ID_PATTERN.test(value)) {
    throw invariantViolation(
      `Finturu ingestion resolved organization "${value}", which is not a 24-character hexadecimal ObjectId`,
      { field: 'organizationId', value },
    );
  }

  return value;
}

function resolvePriorityFromRiskScore(riskScore: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (riskScore >= 80) return 'CRITICAL';
  if (riskScore >= 60) return 'HIGH';
  if (riskScore >= 30) return 'MEDIUM';
  return 'LOW';
}

/**
 * Webhook Ingestion Use Case for Finturu consolidated payload (Bridge, Stripe, Coinflow).
 * Atomically writes to 4 collections:
 * 1. Cases (Status: OPEN, FinturuCacheSnapshot: raw payload, RiskScore, Bridge/Stripe IDs)
 * 2. CaseTimeline (CASE_CREATED event)
 * 3. AuditLogs (CASE_INGESTED_WEBHOOK audit record)
 * 4. OutboxEvents (case.created transactional event with status PENDING)
 */
export function createIngestFinturuCaseUseCase(deps: IngestFinturuCaseDeps) {
  return async function ingestFinturuCase(input: IngestFinturuCaseInput): Promise<IngestFinturuCaseResult> {
    const raw = input.rawPayload;

    // 1. Resolve OrganizationId
    const explicitOrgId =
      extractString(raw, ['organization_id', 'organizationId', 'orgId', 'organizationSlug', 'organization_slug']) ??
      input.organizationId ??
      input.defaultOrganizationId;

    const organizationId = requireTenantId(explicitOrgId);

    // 2. Extract Customer ID (idUser, customer_id, customerId, etc.)
    const customerId =
      extractString(raw, ['idUser', 'customer_id', 'customerId', 'userId']) ??
      (typeof raw.customer === 'object' && raw.customer !== null
        ? extractString(raw.customer as Record<string, unknown>, ['idUser', 'id', 'customerId'])
        : null) ??
      `cust_${Date.now()}`;

    // 3. Extract Bridge User ID (idUserBridge, bridge_user_id, bridgeUserId, etc.)
    const bridgeUserId =
      extractString(raw, ['idUserBridge', 'bridge_user_id', 'bridgeUserId', 'bridgeCustomerId', 'customerIdBridge']) ??
      (typeof raw.bridge === 'object' && raw.bridge !== null
        ? extractString(raw.bridge as Record<string, unknown>, ['idUserBridge', 'user_id', 'userId', 'customerId'])
        : null) ??
      (typeof raw.customer === 'object' && raw.customer !== null
        ? extractString(raw.customer as Record<string, unknown>, ['idUserBridge'])
        : null);

    // 4. Extract Bridge Wallet (address, bridge_wallet, bridgeWallet, idWallet, etc.)
    let bridgeWallet =
      extractString(raw, ['address', 'bridge_wallet', 'bridgeWallet', 'walletBridge', 'idWallet', 'walletAddress']) ??
      (typeof raw.wallet === 'object' && raw.wallet !== null
        ? extractString(raw.wallet as Record<string, unknown>, ['address', 'idWallet'])
        : null) ??
      (typeof raw.bridge === 'object' && raw.bridge !== null
        ? extractString(raw.bridge as Record<string, unknown>, ['wallet', 'address', 'wallet_address', 'idWallet'])
        : null);

    if (!bridgeWallet && Array.isArray(raw.wallets) && raw.wallets.length > 0) {
      const firstWallet = raw.wallets[0];
      if (typeof firstWallet === 'object' && firstWallet !== null) {
        bridgeWallet = extractString(firstWallet as Record<string, unknown>, ['address', 'idWallet']);
      }
    }

    // 5. Extract Stripe Customer ID (idCustomer, stripe_customer_id, stripeCustomerId, etc.)
    const stripeCustomerId =
      extractString(raw, ['idCustomer', 'stripe_customer_id', 'stripeCustomerId', 'stripeId']) ??
      (typeof raw.stripe === 'object' && raw.stripe !== null
        ? extractString(raw.stripe as Record<string, unknown>, ['idCustomer', 'customer_id', 'customerId'])
        : null);

    // 6. Extract Customer Email
    const customerEmail =
      extractString(raw, ['email', 'customer_email', 'customerEmail']) ??
      (typeof raw.customer === 'object' && raw.customer !== null
        ? extractString(raw.customer as Record<string, unknown>, ['email'])
        : null) ??
      (typeof raw.stripe === 'object' && raw.stripe !== null
        ? extractString(raw.stripe as Record<string, unknown>, ['email'])
        : null);

    // 7. Calculate Risk Score and Priority
    const rawRiskScore = raw.risk_score ?? raw.riskScore;
    const numericScore = typeof rawRiskScore === 'number' && !Number.isNaN(rawRiskScore) ? Math.min(100, Math.max(0, rawRiskScore)) : 50;
    const riskScore = createRiskScore(numericScore);

    const explicitPriority = extractString(raw, ['priority']);
    const priority = createCasePriority(explicitPriority ?? resolvePriorityFromRiskScore(numericScore));

    const now = deps.clock.now();

    return deps.unitOfWork.withTransaction(async (tx) => {
      // 0. Check if a case already exists for this customer or bridge user
      // CASE-011: only an ACTIVE case deduplicates. Previously the lookup did
      // not look at status, so a case already RESOLVED or ARCHIVED absorbed the
      // recurrence: the customer was reported again and, instead of opening a
      // new case, the snapshot of the one that was already closed was overwritten.
      const existingCase = await deps.cases.findByCustomerOrBridgeId(
        {
          organizationId,
          customerId,
          bridgeUserId,
          statuses: ACTIVE_CASE_STATUSES,
        },
        tx,
      );

      if (existingCase) {
        const updatedCase = existingCase.updateFinturuSnapshot({
          finturuCacheSnapshot: raw,
          riskScore,
          priority,
          customerEmail,
          bridgeUserId,
          bridgeWallet,
          stripeCustomerId,
          now,
        });

        // CASE-007: the due date depends on priority, so a recurrence that
        // raises the risk must shorten the clock. If priority did not move,
        // the original `dueDate` is left: resetting it on every snapshot
        // refresh would grant time indefinitely and the SLA would stop
        // meaning anything.
        let recomputed = updatedCase;
        if (updatedCase.priority !== existingCase.priority) {
          const dueDate = await deps.initializeCaseSla({
            organizationId,
            caseId: updatedCase.id,
            priority: updatedCase.priority,
            now,
            tx,
          });
          recomputed = updatedCase.withDueDate(dueDate, now);
        }

        await deps.cases.save(recomputed, tx);

        // The timeline milestone is part of the CASE-011 contract: without
        // it, a recurrence on an open case was absorbed in silence and the
        // analyst had no way to know that Finturu had reported the same
        // customer again.
        if (input.recordTimeline !== false) {
          const resnapshotEvent = CaseTimelineEvent.create({
            id: deps.generateTimelineEventId(),
            caseId: recomputed.id,
            eventType: 'SNAPSHOT_REFRESHED',
            previousValue: existingCase.riskScore.toString(),
            newValue: recomputed.riskScore.toString(),
            createdBy: 'SYSTEM_WEBHOOK',
            createdAt: now,
          });
          await deps.timelineRecorder.record(resnapshotEvent, tx);
        }

        const updateOutboxEventId = deps.generateOutboxEventId();
        await deps.outbox.save(
          OutboxEvent.create({
            id: updateOutboxEventId,
            organizationId,
            aggregateType: 'case',
            aggregateId: recomputed.id,
            eventType: 'case.snapshot_refreshed',
            payload: {
              caseId: recomputed.id,
              organizationId,
              customerId: recomputed.customerId,
              riskScore: recomputed.riskScore,
              priority: recomputed.priority,
            },
            now,
          }),
          tx,
        );

        return {
          case: recomputed,
          outboxEventId: updateOutboxEventId,
        };
      }

      // 1. Create Case Aggregate with snapshot
      const caseId = deps.generateCaseId();

      const dueDate = await deps.initializeCaseSla({
        organizationId,
        caseId,
        priority,
        now,
        tx,
      });

      // The Finturu payload may bring its own tags; if not, origin and channel
      // are marked so the inbox knows where it came from.
      const tags = Array.isArray(raw.tags)
        ? (raw.tags.filter((t) => typeof t === 'string') as string[])
        : ['WEBHOOK_INTAKE', 'FINTURU'];

      const kase = Case.create({
        id: caseId,
        organizationId,
        customerId,
        customerEmail,
        bridgeUserId,
        bridgeWallet,
        stripeCustomerId,
        finturuReference: typeof raw.reference === 'object' && raw.reference !== null ? (raw.reference as Record<string, unknown>) : null,
        finturuCacheSnapshot: raw,
        riskScore,
        priority,
        tags,
        now,
      }).withDueDate(dueDate, now);

      await deps.cases.save(kase, tx);

      // 2. Record Timeline Event (only if not explicitly disabled by bulk sync)
      if (input.recordTimeline !== false) {
        const timelineEvent = CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId: kase.id,
          eventType: 'CASE_CREATED',
          previousValue: null,
          newValue: 'OPEN',
          createdBy: 'SYSTEM_WEBHOOK',
          createdAt: now,
        });
        await deps.timelineRecorder.record(timelineEvent, tx);
      }

      // CASE-002: routing matters more on this path than on the manual one —
      // a case that arrives via webhook has nobody in front of it to assign it.
      // `RouteCase` persists the assignment, emits its own `ASSIGNED` milestone,
      // and audits the winning rule, all inside this same transaction.
      // `createdBy: null` because the rule, not a human, chose the assignee.
      const routedCase = deps.routeCase
        ? await deps.routeCase({
            kase,
            tx,
            createdBy: null,
            actorType: 'ORGANIZATION',
            ipAddress: input.ipAddress ?? null,
          })
        : kase;

      // 3. Record Audit Log
      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: 'ORGANIZATION',
          actorId: 'webhook_finturu',
          action: 'CREATE_CASE',
          resource: 'case',
          resourceId: kase.id,
          detail: {
            source: 'WEBHOOK_FINTURU',
            customerId: kase.customerId,
            riskScore: kase.riskScore,
            priority: kase.priority,
            bridgeUserId: kase.bridgeUserId,
            bridgeWallet: kase.bridgeWallet,
            stripeCustomerId: kase.stripeCustomerId,
          },
          ipAddress: input.ipAddress ?? null,
        },
        tx,
      );

      // 4. Record Outbox Event — emitted on `routedCase`, not on `kase`,
      // so the consumer sees the case as it was committed (with an assignee
      // if some rule assigned one).
      const outboxEventId = deps.generateOutboxEventId();
      const outboxEvent = OutboxEvent.create({
        id: outboxEventId,
        organizationId: routedCase.organizationId,
        aggregateType: 'Case',
        aggregateId: routedCase.id,
        eventType: 'case.created',
        payload: {
          caseId: routedCase.id,
          organizationId: routedCase.organizationId,
          customerId: routedCase.customerId,
          customerEmail: routedCase.customerEmail,
          bridgeUserId: routedCase.bridgeUserId,
          bridgeWallet: routedCase.bridgeWallet,
          stripeCustomerId: routedCase.stripeCustomerId,
          riskScore: routedCase.riskScore,
          status: routedCase.status,
          priority: routedCase.priority,
          assignedTo: routedCase.assignedTo?.id ?? null,
          createdAt: routedCase.createdAt,
        },
        now,
      });
      await deps.outbox.save(outboxEvent, tx);

      return {
        case: routedCase,
        outboxEventId,
      };
    });
  };
}

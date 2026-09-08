import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { CaseSlaTrackingRepository } from '../domain/ports/CaseSlaTrackingRepository.js';
import type { NotificationSender } from '../domain/ports/NotificationSender.js';
import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import type { UnitOfWork, Transaction } from '../domain/ports/UnitOfWork.js';
import type { CaseSlaTracking } from '../domain/model/aggregates/CaseSlaTracking.js';
import type { SlaStatus } from '../domain/model/value-objects/SlaStatus.js';
import { slaStatusTransitions } from '../domain/services/transitions.js';

export interface SweepSlaTrackingDeps {
  readonly slaTracking: CaseSlaTrackingRepository;
  readonly cases: CaseRepository;
  readonly notificationSender: NotificationSender;
  readonly assigneeDirectory: AssigneeDirectory;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly outbox: OutboxEventRepository;
  readonly generateOutboxEventId: () => OutboxEventId;
}

export interface SweepSlaTrackingResult {
  readonly processed: number;
  readonly advanced: number;
  readonly notified: number;
}

/** Single forward-only hop per due row (ON_TRACK->WARNING or WARNING->BREACHED). BREACHED rows are never claimed by `claimDueForSweep`. */
function nextStatus(tracking: CaseSlaTracking): SlaStatus | null {
  const [next] = slaStatusTransitions[tracking.status];
  return next ?? null;
}

/** Outbox catalog names (not AlertType). ON_TRACK→WARNING / WARNING→BREACHED. */
function slaHopOutboxEventType(previousStatus: SlaStatus, status: SlaStatus): 'SLA_WARNING' | 'SLA_BREACHED' {
  if (previousStatus === 'WARNING' && status === 'BREACHED') {
    return 'SLA_BREACHED';
  }
  return 'SLA_WARNING';
}

/** Copies `closeCase.emitOutbox`: one PENDING row per successful hop, same per-row UoW. */
async function emitSlaHopOutbox(
  deps: SweepSlaTrackingDeps,
  tx: Transaction,
  input: {
    readonly kase: Case;
    readonly advanced: CaseSlaTracking;
    readonly previousStatus: SlaStatus;
    readonly now: Instant;
  },
): Promise<void> {
  await deps.outbox.save(
    OutboxEvent.create({
      id: deps.generateOutboxEventId(),
      organizationId: input.kase.organizationId,
      eventType: slaHopOutboxEventType(input.previousStatus, input.advanced.status),
      aggregateType: 'cases',
      aggregateId: input.advanced.caseId,
      payload: {
        case_id: input.advanced.caseId,
        organization_id: input.kase.organizationId,
        sla_tracking_id: input.advanced.id,
        previous_status: input.previousStatus,
        status: input.advanced.status,
        due_date: input.advanced.dueDate,
      },
      now: input.now,
    }),
    tx,
  );
}

/** Max rows claimed per sweep tick (bounds the atomic-claim loop, mirrors the outbox dispatcher). */
const SWEEP_CLAIM_LIMIT = 100;

/**
 * Background sweep (Slice 13, design D6): advances each due `CaseSlaTracking`
 * row by one status hop and sends `SLA_DUE_SOON` once per status.
 * Multi-instance safe: `claimDueForSweep` takes an exclusive per-row lease,
 * so concurrent sweep instances never process the same due row twice
 * (mirrors the outbox `claimPending`).
 *
 * Each row is processed in its OWN `unitOfWork.withTransaction` (ADR-D6): a
 * mid-batch failure leaves already-processed rows committed and the failing
 * row retried on the next tick, instead of rolling back the whole batch.
 *
 * Notification recipient rule mirrors `ReassignCase`: a `USER` assignee is
 * notified directly; a `ROLE` assignee fans out to every active member of
 * the role (each honoring their own EMAIL opt-out downstream); an unassigned
 * case still advances status and is marked notified, but notifies no one.
 *
 * A case that is formally closed (RESOLVED or ARCHIVED) is skipped entirely:
 * it no longer advances the SLA status, notifies, or is marked (PR4).
 */
export function createSweepSlaTrackingUseCase(deps: SweepSlaTrackingDeps) {
  return async function sweepSlaTracking(): Promise<SweepSlaTrackingResult> {
    const now = deps.clock.now();
    const due = await deps.slaTracking.claimDueForSweep(now, SWEEP_CLAIM_LIMIT);

    let advancedCount = 0;
    let notifiedCount = 0;

    for (const row of due) {
      await deps.unitOfWork.withTransaction(async (tx) => {
        const current = (await deps.slaTracking.findByCaseId(row.caseId, tx)) ?? row;
        if (current.status === 'BREACHED') {
          return;
        }

        const kase = await deps.cases.findById(current.caseId, tx);
        // A formally closed case no longer escalates: skip the advance, the
        // notification, and the mark entirely (case-lifecycle-core PR4).
        if (kase !== null && (kase.status === 'RESOLVED' || kase.status === 'ARCHIVED')) {
          return;
        }

        const previousStatus = current.status;
        const target = nextStatus(current);
        let advanced = current;
        if (target !== null) {
          advanced = current.advanceTo(target, now);
          advancedCount += 1;
        }

        if (!advanced.hasNotified(advanced.status)) {
          if (kase !== null && kase.assignedTo !== null) {
            const recipientUserIds =
              kase.assignedTo.type === 'USER'
                ? [kase.assignedTo.id]
                : await deps.assigneeDirectory.listRoleRecipients(kase.organizationId, kase.assignedTo.id);
            for (const recipientUserId of recipientUserIds) {
              await deps.notificationSender.send(
                {
                  organizationId: kase.organizationId,
                  recipientUserId,
                  alertType: 'SLA_DUE_SOON',
                  context: { caseId: advanced.caseId, dueDate: advanced.dueDate, status: advanced.status },
                },
                tx,
              );
              notifiedCount += 1;
            }
          }
          advanced = advanced.markNotified(advanced.status, now);
        }

        if (target !== null && kase !== null) {
          await emitSlaHopOutbox(deps, tx, { kase, advanced, previousStatus, now });
        }

        await deps.slaTracking.save(advanced, tx);
      });
    }

    return { processed: due.length, advanced: advancedCount, notified: notifiedCount };
  };
}

import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { CaseSlaTrackingRepository } from '../domain/ports/CaseSlaTrackingRepository.js';
import type { NotificationSender } from '../domain/ports/NotificationSender.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { CaseSlaTracking } from '../domain/model/aggregates/CaseSlaTracking.js';
import type { SlaStatus } from '../domain/model/value-objects/SlaStatus.js';
import { slaStatusTransitions } from '../domain/services/transitions.js';

export interface SweepSlaTrackingDeps {
  readonly slaTracking: CaseSlaTrackingRepository;
  readonly cases: CaseRepository;
  readonly notificationSender: NotificationSender;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

export interface SweepSlaTrackingResult {
  readonly processed: number;
  readonly advanced: number;
  readonly notified: number;
}

/** Single forward-only hop per due row (ON_TRACK->WARNING or WARNING->BREACHED). BREACHED rows are never returned by `findDueForSweep`. */
function nextStatus(tracking: CaseSlaTracking): SlaStatus | null {
  const [next] = slaStatusTransitions[tracking.status];
  return next ?? null;
}

/**
 * Background sweep (Slice 13, design D6): advances each due `CaseSlaTracking`
 * row by one status hop and sends `SLA_POR_VENCER` exactly once per row
 * (idempotency guard: `notificationSent`/`markNotified`, NOT a distributed
 * lock — see `SlaSweepScheduler`'s single-instance caveat).
 *
 * Each row is processed in its OWN `unitOfWork.withTransaction` (ADR-D6): a
 * mid-batch failure leaves already-processed rows committed and the failing
 * row retried on the next tick, instead of rolling back the whole batch.
 *
 * Notification recipient rule mirrors `ReassignCase` (ADR-D4): only a `USER`
 * assignee has a per-user inbox/opt-out row, so a `ROLE`-assigned or
 * unassigned case still advances status and is marked notified, but no
 * notification is sent.
 */
export function createSweepSlaTrackingUseCase(deps: SweepSlaTrackingDeps) {
  return async function sweepSlaTracking(): Promise<SweepSlaTrackingResult> {
    const now = deps.clock.now();
    const due = await deps.slaTracking.findDueForSweep(now);

    let advancedCount = 0;
    let notifiedCount = 0;

    for (const row of due) {
      await deps.unitOfWork.withTransaction(async (tx) => {
        const current = (await deps.slaTracking.findByCaseId(row.caseId, tx)) ?? row;
        if (current.status === 'BREACHED') {
          return;
        }

        const target = nextStatus(current);
        let advanced = current;
        if (target !== null) {
          advanced = current.advanceTo(target, now);
          advancedCount += 1;
        }

        if (!advanced.hasNotified(advanced.status)) {
          const kase = await deps.cases.findById(advanced.caseId, tx);
          if (kase !== null && kase.assignedTo !== null && kase.assignedTo.type === 'USER') {
            await deps.notificationSender.send(
              {
                organizationId: kase.organizationId,
                recipientUserId: kase.assignedTo.id,
                alertType: 'SLA_POR_VENCER',
                context: { caseId: advanced.caseId, dueDate: advanced.dueDate, status: advanced.status },
              },
              tx,
            );
            notifiedCount += 1;
          }
          advanced = advanced.markNotified(advanced.status, now);
        }

        await deps.slaTracking.save(advanced, tx);
      });
    }

    return { processed: due.length, advanced: advancedCount, notified: notifiedCount };
  };
}

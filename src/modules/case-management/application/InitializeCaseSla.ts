import type { Instant } from '../../../shared/time/Instant.js';
import type { CaseSlaTrackingRepository } from '../domain/ports/CaseSlaTrackingRepository.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import type { CaseId } from '../domain/model/value-objects/CaseId.js';
import type { CasePriority } from '../domain/model/value-objects/CasePriority.js';
import type { CaseSlaTrackingId } from '../domain/model/value-objects/CaseSlaTrackingId.js';
import { CaseSlaTracking } from '../domain/model/aggregates/CaseSlaTracking.js';
import { resolveSlaDueDate, slaWindowFromConfig } from '../domain/services/SlaPolicy.js';

export interface InitializeCaseSlaInput {
  readonly organizationId: string;
  readonly caseId: CaseId;
  readonly priority: CasePriority;
  readonly now: Instant;
  readonly tx?: Transaction;
}

export interface InitializeCaseSlaDeps {
  readonly slaTracking: CaseSlaTrackingRepository;
  readonly fraudConfig: OrganizationFraudConfigRepository;
  readonly generateCaseSlaTrackingId: () => CaseSlaTrackingId;
}

/**
 * CASE-003 — T2 SLA calculation. Resolves the tenant's window for the case's
 * priority, writes the `CaseSlaTracking` row as ON_TRACK, and hands the
 * caller the `dueDate` so it can denormalize it onto `Case.DueDate`.
 *
 * Always called INSIDE the caller's transaction: the tracking row and the
 * case it belongs to must land together, or a case would exist with a
 * deadline nothing is measuring.
 *
 * Reuses the tracking row when one already exists for the case (reopen path,
 * CASE-009) instead of inserting a second — `sla_tracking_case_unique` would
 * reject that anyway, and `reset()` is the aggregate's own answer for it.
 */
export function createInitializeCaseSlaService(deps: InitializeCaseSlaDeps) {
  return async function initializeCaseSla(input: InitializeCaseSlaInput): Promise<Instant> {
    const config = await deps.fraudConfig.findByOrganization(input.organizationId, input.tx);
    const dueDate = resolveSlaDueDate(slaWindowFromConfig(config), input.priority, input.now);

    const existing = await deps.slaTracking.findByCaseId(input.caseId, input.tx);

    const tracking = existing
      ? existing.reset(dueDate, input.now)
      : CaseSlaTracking.create({
          id: deps.generateCaseSlaTrackingId(),
          caseId: input.caseId,
          dueDate,
          now: input.now,
        });

    await deps.slaTracking.save(tracking, input.tx);

    return dueDate;
  };
}

export type InitializeCaseSlaService = ReturnType<typeof createInitializeCaseSlaService>;

import type { Clock } from '../../../shared/time/Clock.js';
import { fromDate, toDate } from '../../../shared/time/Instant.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import { CaseSlaTracking } from '../domain/model/aggregates/CaseSlaTracking.js';
import type { CaseSlaTrackingId } from '../domain/model/value-objects/CaseSlaTrackingId.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { CaseSlaTrackingRepository } from '../domain/ports/CaseSlaTrackingRepository.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import { organizationFraudConfigNotFound } from '../domain/errors/CaseManagementError.js';

const MS_PER_MINUTE = 60_000;

export interface CalculateSlaInput {
  readonly kase: Case;
  readonly tx: Transaction;
}

export interface CalculateSlaDeps {
  readonly cases: CaseRepository;
  readonly slaTracking: CaseSlaTrackingRepository;
  readonly fraudConfig: OrganizationFraudConfigRepository;
  readonly clock: Clock;
  readonly generateCaseSlaTrackingId: () => CaseSlaTrackingId;
}

/**
 * T2 — SLA on create (design: "CreateCase + SLA"). Fail-closed when the
 * tenant has no OrganizationFraudConfig. Uses Instant Date helpers
 * (`toDate`/`fromDate` + minute offset) — no Instant arithmetic API.
 */
export function createCalculateSlaUseCase(deps: CalculateSlaDeps) {
  return async function calculateSla(input: CalculateSlaInput): Promise<Case> {
    const now = deps.clock.now();
    const config = await deps.fraudConfig.findByOrganization(input.kase.organizationId, input.tx);
    if (!config) {
      throw organizationFraudConfigNotFound(input.kase.organizationId);
    }

    const minutes = config.slaMinutesFor(input.kase.priority);
    const dueDate = fromDate(new Date(toDate(now).getTime() + minutes * MS_PER_MINUTE));

    const tracking = CaseSlaTracking.create({
      id: deps.generateCaseSlaTrackingId(),
      caseId: input.kase.id,
      dueDate,
      now,
    });
    await deps.slaTracking.save(tracking, input.tx);

    const withDue = input.kase.withDueDate(dueDate, now);
    await deps.cases.save(withDue, input.tx);
    return withDue;
  };
}

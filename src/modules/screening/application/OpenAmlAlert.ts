import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { AmlAlertId } from '../domain/model/value-objects/AmlAlertId.js';
import type { MatchScore } from '../domain/model/value-objects/MatchScore.js';
import type { ScreeningMatch } from '../domain/model/entities/ScreeningMatch.js';
import { AmlAlert } from '../domain/model/aggregates/AmlAlert.js';
import type { AmlAlertRepository } from '../domain/ports/AmlAlertRepository.js';
import type { AmlAlertTimelineRecorder } from '../domain/ports/AmlAlertTimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import type { ConfidenceThresholds } from '../domain/services/ConfidenceTiering.js';
import { DEFAULT_CONFIDENCE_THRESHOLDS } from '../domain/services/ConfidenceTiering.js';
import { calculateAmlAlertSeverity } from '../domain/services/AmlAlertSeverityCalculator.js';
import { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export const AML_ALERT_CREATED = 'AML_ALERT_CREATED';

export interface OpenAmlAlertInput {
  readonly auth: AuthContext;
  readonly customerId: string;
  readonly match: ScreeningMatch;
  readonly confidence: MatchScore;
  /**
   * Request-scoped per-org thresholds (D-8). Falls back to deps, then
   * `DEFAULT_CONFIDENCE_THRESHOLDS`.
   */
  readonly thresholds?: ConfidenceThresholds;
}

export interface OpenAmlAlertResult {
  readonly opened: boolean;
  readonly duplicate: boolean;
  readonly alert: AmlAlert | null;
}

export interface OpenAmlAlertDeps {
  readonly amlAlertRepository: AmlAlertRepository;
  readonly timelineRecorder: AmlAlertTimelineRecorder;
  readonly outbox: OutboxEventRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateAmlAlertId: () => AmlAlertId;
  readonly generateTimelineEventId: () => string;
  readonly generateOutboxEventId: () => OutboxEventId;
  readonly thresholds?: ConfidenceThresholds;
}

/**
 * Opens an AML alert when similarity (`confidence`) meets the org's
 * configured alert threshold. Within ONE `unitOfWork.withTransaction`:
 * inserts `aml_alerts` (status OPEN, calculated `severity`), appends a
 * `CASE_CREATED` `case_timeline` row keyed by the alert id, and emits an
 * `AML_ALERT_CREATED` `outbox_events` row. Idempotent on the alert natural
 * key (RF-6): a duplicate save skips timeline and outbox.
 */
export function createOpenAmlAlertUseCase(deps: OpenAmlAlertDeps) {
  return async function openAmlAlert(input: OpenAmlAlertInput): Promise<OpenAmlAlertResult> {
    const organizationId = requireTenantContext(input.auth);
    const thresholds = input.thresholds ?? deps.thresholds ?? DEFAULT_CONFIDENCE_THRESHOLDS;
    const severity = calculateAmlAlertSeverity(input.confidence, thresholds, input.match.riskLevel);
    if (severity === null) {
      return { opened: false, duplicate: false, alert: null };
    }

    const now = deps.clock.now();
    const alert = AmlAlert.create({
      id: deps.generateAmlAlertId(),
      organizationId,
      customerId: input.customerId,
      suspectedEntity: input.match.name,
      confidence: input.confidence,
      detectionSource: String(input.match.watchlistId),
      severity,
      matchedEntry: input.match,
      now,
    });

    return deps.unitOfWork.withTransaction(async (tx) => {
      const outcome = await deps.amlAlertRepository.save(alert, tx);
      if (outcome !== 'inserted') {
        const existing = await deps.amlAlertRepository.findByNaturalKey(
          {
            organizationId,
            customerId: input.customerId,
            entryId: String(input.match.entryId),
            matchField: input.match.matchField,
          },
          tx,
        );
        return { opened: false, duplicate: true, alert: existing };
      }

      await deps.timelineRecorder.record(
        {
          id: deps.generateTimelineEventId(),
          caseId: String(alert.id),
          eventType: 'CASE_CREATED',
          previousValue: null,
          newValue: 'OPEN',
          createdBy: input.auth.userId,
          createdAt: now,
        },
        tx,
      );

      await deps.outbox.save(
        OutboxEvent.create({
          id: deps.generateOutboxEventId(),
          organizationId,
          eventType: AML_ALERT_CREATED,
          aggregateType: 'aml_alerts',
          aggregateId: String(alert.id),
          payload: {
            alert_id: String(alert.id),
            organization_id: organizationId,
            customer_id: alert.customerId,
            status: alert.status,
            severity: alert.severity,
            confidence: alert.confidence,
            alert_type: alert.alertType,
          },
          now,
        }),
        tx,
      );

      return { opened: true, duplicate: false, alert };
    });
  };
}

import type { Clock } from '../shared/time/Clock.js';
import type { createEnqueueCustomerWebhookFanOut } from '../modules/case-management/application/EnqueueCustomerWebhookFanOut.js';
import type { Transaction as CaseManagementTransaction } from '../modules/case-management/domain/ports/UnitOfWork.js';
import type { createOpenAmlAlertUseCase } from '../modules/screening/application/OpenAmlAlert.js';

/**
 * Boundaries adapter: screening `onOpened` calls case-management fan-out
 * on the live screening session (cast, no second `withTransaction`).
 */
export function createAmlAlertOpenedWebhookFanOut(
  enqueue: ReturnType<typeof createEnqueueCustomerWebhookFanOut>,
  clock: Clock,
): NonNullable<Parameters<typeof createOpenAmlAlertUseCase>[0]['onOpened']> {
  return async ({ alert, organizationId, tx }) => {
    await enqueue({
      organizationId,
      customerId: alert.customerId,
      eventType: 'aml.alert_generated',
      kafkaFacts: {
        alert_id: String(alert.id),
        organization_id: organizationId,
        customer_id: alert.customerId,
        status: alert.status,
        severity: alert.severity,
        confidence: alert.confidence,
        alert_type: alert.alertType,
      },
      now: clock.now(),
      tx: tx as unknown as CaseManagementTransaction,
    });
  };
}

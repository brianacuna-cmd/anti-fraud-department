import { invariantViolation } from '../../errors/CaseManagementError.js';

/**
 * Closed catalog of ticket event names persisted on a webhook subscription.
 * Kafka SCREAMING constants (`CASE_RESOLVED`, `AML_ALERT_CREATED`) are
 * rejected so the catalog never drifts from the client-facing ticket names.
 */
export type WebhookTicketEventType = 'case.created' | 'case.resolved' | 'aml.alert_generated';

const VALID_TICKET_EVENT_TYPES: ReadonlySet<string> = new Set<WebhookTicketEventType>([
  'case.created',
  'case.resolved',
  'aml.alert_generated',
]);

export function createWebhookTicketEventType(value: string): WebhookTicketEventType {
  if (!VALID_TICKET_EVENT_TYPES.has(value)) {
    throw invariantViolation(
      'WebhookTicketEventType must be one of case.created, case.resolved, aml.alert_generated',
      { value },
    );
  }
  return value as WebhookTicketEventType;
}

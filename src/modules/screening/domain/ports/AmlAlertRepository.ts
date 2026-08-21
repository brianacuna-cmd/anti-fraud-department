import type { AmlAlert } from '../model/aggregates/AmlAlert.js';
import type { AmlAlertId } from '../model/value-objects/AmlAlertId.js';

/**
 * Outbound port for `AmlAlert` persistence (spec RF-6: "Idempotent alert
 * persistence"). `save` MUST be idempotent on the natural key
 * (organizationId + customerId + matchedEntry.entryId + matchedEntry.matchField)
 * so outbox redelivery never creates a duplicate record — upsert or
 * existence-check-then-skip semantics, adapter's choice.
 */
export interface AmlAlertRepository {
  save(alert: AmlAlert): Promise<void>;
  findById(id: AmlAlertId): Promise<AmlAlert | null>;
}

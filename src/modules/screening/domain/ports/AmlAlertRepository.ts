import type { AmlAlert } from '../model/aggregates/AmlAlert.js';
import type { AmlAlertId } from '../model/value-objects/AmlAlertId.js';
import type { AmlAlertStatus } from '../model/value-objects/AmlAlertStatus.js';
import type { AmlAlertSeverity } from '../model/value-objects/AmlAlertSeverity.js';
import type { MatchField } from '../model/value-objects/MatchField.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';

export interface AmlAlertNaturalKey {
  readonly organizationId: string;
  readonly customerId: string;
  readonly entryId: string;
  readonly matchField: MatchField;
}

export interface AmlAlertListQuery {
  readonly organizationId: string;
  readonly status?: readonly AmlAlertStatus[];
  readonly severity?: readonly AmlAlertSeverity[];
  readonly watchlistId?: string;
  readonly createdAfter?: Instant;
  readonly createdBefore?: Instant;
  readonly limit: number;
  readonly offset: number;
}

export interface AmlAlertListResult {
  readonly items: readonly AmlAlert[];
  readonly total: number;
}

/**
 * Outbound port for `AmlAlert` persistence (spec RF-6: "Idempotent alert
 * persistence"). `save` replaces by `_id` when the row exists (triage
 * transitions), inserts on create, and returns `'duplicate'` on a
 * natural-key collision so outbox redelivery never creates a second row.
 */
export interface AmlAlertRepository {
  save(alert: AmlAlert, tx?: Transaction): Promise<'inserted' | 'updated' | 'duplicate'>;
  findById(id: AmlAlertId, tx?: Transaction): Promise<AmlAlert | null>;
  findByNaturalKey(key: AmlAlertNaturalKey, tx?: Transaction): Promise<AmlAlert | null>;
  list(query: AmlAlertListQuery, tx?: Transaction): Promise<AmlAlertListResult>;
}

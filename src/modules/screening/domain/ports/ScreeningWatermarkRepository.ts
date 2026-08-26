import type { Instant } from '../../../../shared/time/Instant.js';

/**
 * Outbound port — durable per-job watermark for the rescreen scheduler (R6).
 *
 * Collection `screening_watermarks` (snake_case):
 *   `{ organization_id, job_name, watermark_at, updated_at }`
 * Unique index: `screening_watermark_org_job_unique` on `(organization_id, job_name)`.
 *
 * Persistence uses a last-write-wins unconditional `$set` upsert (D2).
 * If two runs race, the one that finishes last wins — acceptable because
 * `aml_alerts_natural_key_unique` suppresses duplicate alerts, so a re-scan
 * is safe. Upgrade to `$max` for monotonic writes without a retry loop.
 */
export interface ScreeningWatermarkRepository {
  /**
   * Returns the last-persisted watermark for `(organizationId, jobName)`, or
   * `null` when no run has completed yet.
   */
  read(organizationId: string, jobName: string): Promise<Instant | null>;

  /**
   * Persists `watermark` as the latest-processed timestamp for
   * `(organizationId, jobName)`. Overwrites any prior value unconditionally.
   */
  advance(organizationId: string, jobName: string, watermark: Instant): Promise<void>;
}

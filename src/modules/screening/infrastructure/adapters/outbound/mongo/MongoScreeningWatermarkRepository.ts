import type { Collection, Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { ScreeningWatermarkRepository } from '../../../../domain/ports/ScreeningWatermarkRepository.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import { fromDate, toDate } from '../../../../../../shared/time/Instant.js';

interface ScreeningWatermarkDocument {
  readonly _id: ObjectId;
  readonly organization_id: string;
  readonly job_name: string;
  readonly watermark_at: Date;
  readonly updated_at: Date;
}

const COLLECTION_NAME = 'screening_watermarks';

/**
 * Mongo adapter for `ScreeningWatermarkRepository` (D2).
 *
 * Persistence strategy: unconditional last-write-wins `$set` upsert keyed on
 * `(organization_id, job_name)`.  A concurrent race causes a re-scan on the
 * losing writer — safe because `aml_alerts_natural_key_unique` suppresses
 * duplicate alerts.  Upgrade to `$max` for monotonic writes if re-scan cost
 * grows.
 */
export class MongoScreeningWatermarkRepository implements ScreeningWatermarkRepository {
  private readonly collection: Collection<ScreeningWatermarkDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ScreeningWatermarkDocument>(COLLECTION_NAME);
  }

  async read(organizationId: string, jobName: string): Promise<Instant | null> {
    const document = await this.collection.findOne({
      organization_id: organizationId,
      job_name: jobName,
    });
    return document ? fromDate(document.watermark_at) : null;
  }

  async advance(organizationId: string, jobName: string, watermark: Instant): Promise<void> {
    const now = new Date();
    await this.collection.updateOne(
      { organization_id: organizationId, job_name: jobName },
      {
        $set: {
          watermark_at: toDate(watermark),
          updated_at: now,
        },
        $setOnInsert: {
          _id: new ObjectId(),
          organization_id: organizationId,
          job_name: jobName,
        },
      },
      { upsert: true },
    );
  }
}

import { ObjectId, type Collection, type Db } from 'mongodb';
import { toDate } from '../../time/Instant.js';
import type { ScheduledJob } from '../ScheduledJob.js';
import type {
  RecordScheduledJobRunInput,
  ScheduledJobRepository,
  SeedScheduledJobInput,
} from '../ScheduledJobRepository.js';
import type { ScheduledJobDocument } from './ScheduledJobDocument.js';
import { toDomain } from './ScheduledJobDocumentMapper.js';

const COLLECTION_NAME = 'scheduled_jobs';

/**
 * Shared Mongo adapter for `scheduled_jobs`. Upserts by `name`; `$setOnInsert`
 * keeps `_id`, `created_at`, `name`, and `organization_id` stable.
 */
export class MongoScheduledJobRepository implements ScheduledJobRepository {
  private readonly collection: Collection<ScheduledJobDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ScheduledJobDocument>(COLLECTION_NAME);
  }

  async seed(input: SeedScheduledJobInput): Promise<void> {
    await this.collection.updateOne(
      { name: input.name },
      {
        $set: {
          description: input.description,
          cron_expression: input.cronExpression,
          enabled: input.enabled,
        },
        $setOnInsert: {
          _id: new ObjectId(),
          created_at: toDate(input.now),
          name: input.name,
          organization_id: input.organizationId === null ? null : new ObjectId(input.organizationId),
        },
      },
      { upsert: true },
    );
  }

  async recordRun(input: RecordScheduledJobRunInput): Promise<void> {
    await this.collection.updateOne(
      { name: input.name },
      {
        $set: {
          last_run_at: toDate(input.lastRunAt),
          last_result: input.lastResult,
          last_error: input.lastError,
          next_run_at: toDate(input.nextRunAt),
        },
        $setOnInsert: {
          _id: new ObjectId(),
          created_at: toDate(input.lastRunAt),
          name: input.name,
          organization_id: null,
        },
      },
      { upsert: true },
    );
  }

  async findByName(name: string): Promise<ScheduledJob | null> {
    const document = await this.collection.findOne({ name });
    return document === null ? null : toDomain(document);
  }
}

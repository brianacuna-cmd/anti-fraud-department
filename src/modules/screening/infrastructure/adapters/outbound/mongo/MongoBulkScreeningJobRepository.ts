import type { ClientSession, Collection, Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { BulkScreeningJob } from '../../../../domain/model/aggregates/BulkScreeningJob.js';
import type { BulkScreeningJobId } from '../../../../domain/model/value-objects/BulkScreeningJobId.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import { toDate } from '../../../../../../shared/time/Instant.js';
import type { BulkScreeningJobRepository } from '../../../../domain/ports/BulkScreeningJobRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { BulkScreeningJobDocument } from './documents/BulkScreeningJobDocument.js';
import { toDocument, toDomain } from './mappers/BulkScreeningJobDocumentMapper.js';

const COLLECTION_NAME = 'bulk_screening_jobs';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

/** Mongo adapter for `BulkScreeningJobRepository`. */
export class MongoBulkScreeningJobRepository implements BulkScreeningJobRepository {
  private readonly collection: Collection<BulkScreeningJobDocument>;

  constructor(db: Db) {
    this.collection = db.collection<BulkScreeningJobDocument>(COLLECTION_NAME);
  }

  async create(job: BulkScreeningJob, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(job), { session: toSession(tx) });
  }

  async findByIdForOrg(
    id: BulkScreeningJobId,
    organizationId: string,
    tx?: Transaction,
  ): Promise<BulkScreeningJob | null> {
    const document = await this.collection.findOne(
      { _id: new ObjectId(id), organization_id: new ObjectId(organizationId) },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }

  async incrementProgress(
    id: BulkScreeningJobId,
    amount: number,
    now: Instant,
    tx?: Transaction,
  ): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(id) },
      { $inc: { processed_rows: amount }, $set: { updated_at: toDate(now) } },
      { session: toSession(tx) },
    );
  }

  async saveStatus(job: BulkScreeningJob, tx?: Transaction): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(job.id) },
      {
        $set: {
          status: job.status,
          total_rows: job.totalRows,
          errors: job.errors,
          omitted: job.omitted,
          updated_at: toDate(job.updatedAt),
        },
      },
      { session: toSession(tx) },
    );
  }
}

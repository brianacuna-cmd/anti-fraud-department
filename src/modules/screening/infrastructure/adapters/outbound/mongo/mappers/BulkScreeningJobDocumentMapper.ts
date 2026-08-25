import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { BulkScreeningJob } from '../../../../../domain/model/aggregates/BulkScreeningJob.js';
import { createBulkScreeningJobId } from '../../../../../domain/model/value-objects/BulkScreeningJobId.js';
import { createBulkScreeningJobStatus } from '../../../../../domain/model/value-objects/BulkScreeningJobStatus.js';
import type { BulkScreeningJobDocument } from '../documents/BulkScreeningJobDocument.js';

/** snake_case (Mongo) -> camelCase (domain). Instant fields are BSON `Date`. */
export function toDomain(document: BulkScreeningJobDocument): BulkScreeningJob {
  return BulkScreeningJob.rehydrate({
    id: createBulkScreeningJobId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    filePath: document.file_path,
    status: createBulkScreeningJobStatus(document.status),
    totalRows: document.total_rows,
    processedRows: document.processed_rows,
    errors: document.errors,
    omitted: document.omitted,
    createdBy: document.created_by,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

/** camelCase (domain) -> snake_case (Mongo). */
export function toDocument(job: BulkScreeningJob): BulkScreeningJobDocument {
  return {
    _id: new ObjectId(job.id),
    organization_id: new ObjectId(job.organizationId),
    file_path: job.filePath,
    status: job.status,
    total_rows: job.totalRows,
    processed_rows: job.processedRows,
    errors: job.errors,
    omitted: job.omitted,
    created_by: job.createdBy,
    created_at: toDate(job.createdAt),
    updated_at: toDate(job.updatedAt),
  };
}

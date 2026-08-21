import { ObjectId, type ClientSession, type Collection, type Db, type Filter } from 'mongodb';
import type { Case } from '../../../../domain/model/aggregates/Case.js';
import type {
  CaseListQuery,
  CaseListResult,
  CaseRepository,
} from '../../../../domain/ports/CaseRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseDocument } from './documents/CaseDocument.js';
import { toDocument, toDomain } from './mappers/CaseDocumentMapper.js';
import { toDate } from '../../../../../../shared/time/Instant.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors identity-access). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'cases';

/** Mongo adapter for `CaseRepository` (save/findById + inbox list). */
export class MongoCaseRepository implements CaseRepository {
  private readonly collection: Collection<CaseDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseDocument>(COLLECTION_NAME);
  }

  async save(kase: Case, tx?: Transaction): Promise<void> {
    const document = toDocument(kase);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: CaseId, tx?: Transaction): Promise<Case | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async list(query: CaseListQuery, tx?: Transaction): Promise<CaseListResult> {
    const filter = buildListFilter(query);
    const session = toSession(tx);
    const total = await this.collection.countDocuments(filter, { session });

    // Aggregation so null due_date sorts last (Mongo find ASC puts nulls first).
    const documents = await this.collection
      .aggregate<CaseDocument>(
        [
          { $match: filter },
          {
            $addFields: {
              _due_sort: { $cond: [{ $eq: ['$due_date', null] }, 1, 0] },
            },
          },
          { $sort: { _due_sort: 1, due_date: 1 } },
          { $skip: query.offset },
          { $limit: query.limit },
          { $project: { _due_sort: 0 } },
        ],
        { session },
      )
      .toArray();

    return { items: documents.map(toDomain), total };
  }
}

function statusFilterFragment(query: CaseListQuery): Record<string, unknown> {
  return query.status !== undefined && query.status.length > 0 ? { status: { $in: [...query.status] } } : {};
}

function priorityFilterFragment(query: CaseListQuery): Record<string, unknown> {
  return query.priority !== undefined && query.priority.length > 0
    ? { priority: { $in: [...query.priority] } }
    : {};
}

function assignedToFilterFragment(query: CaseListQuery): Record<string, unknown> {
  return query.assignedToId !== undefined ? { assigned_to: query.assignedToId } : {};
}

function riskScoreFilterFragment(query: CaseListQuery): Record<string, unknown> {
  if (query.riskScoreMin === undefined && query.riskScoreMax === undefined) {
    return {};
  }
  return {
    risk_score: {
      ...(query.riskScoreMin !== undefined ? { $gte: query.riskScoreMin } : {}),
      ...(query.riskScoreMax !== undefined ? { $lte: query.riskScoreMax } : {}),
    },
  };
}

function tagsFilterFragment(query: CaseListQuery): Record<string, unknown> {
  return query.tags !== undefined && query.tags.length > 0 ? { tags: { $all: [...query.tags] } } : {};
}

function dueDateFilterFragment(query: CaseListQuery): Record<string, unknown> {
  if (query.dueAfter === undefined && query.dueBefore === undefined) {
    return {};
  }
  return {
    due_date: {
      ...(query.dueAfter !== undefined ? { $gte: toDate(query.dueAfter) } : {}),
      ...(query.dueBefore !== undefined ? { $lt: toDate(query.dueBefore) } : {}),
    },
  };
}

function buildListFilter(query: CaseListQuery): Filter<CaseDocument> {
  const filter: Record<string, unknown> = {
    organization_id: new ObjectId(query.organizationId),
    deleted_at: null,
    ...statusFilterFragment(query),
    ...priorityFilterFragment(query),
    ...assignedToFilterFragment(query),
    ...riskScoreFilterFragment(query),
    ...tagsFilterFragment(query),
    ...dueDateFilterFragment(query),
  };

  return filter as Filter<CaseDocument>;
}

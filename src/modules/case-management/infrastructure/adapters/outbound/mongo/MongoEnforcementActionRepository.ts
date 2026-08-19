import { ObjectId, type ClientSession, type Collection, type Db, type Filter } from 'mongodb';
import type { EnforcementAction } from '../../../../domain/model/aggregates/EnforcementAction.js';
import type {
  EnforcementActionRepository,
  EnforcementActionListQuery,
  EnforcementActionListResult,
} from '../../../../domain/ports/EnforcementActionRepository.js';
import type { EnforcementActionId } from '../../../../domain/model/value-objects/EnforcementActionId.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { EnforcementActionDocument } from './documents/EnforcementActionDocument.js';
import { toDocument, toDomain } from './mappers/EnforcementActionDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'enforcement_actions';

export class MongoEnforcementActionRepository implements EnforcementActionRepository {
  private readonly collection: Collection<EnforcementActionDocument>;

  constructor(db: Db) {
    this.collection = db.collection<EnforcementActionDocument>(COLLECTION_NAME);
  }

  async save(action: EnforcementAction, tx?: Transaction): Promise<void> {
    const document = toDocument(action);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: EnforcementActionId, tx?: Transaction): Promise<EnforcementAction | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findByCaseId(caseId: CaseId, tx?: Transaction): Promise<EnforcementAction[]> {
    const documents = await this.collection
      .find({ case_id: new ObjectId(caseId) }, { session: toSession(tx) })
      .toArray();
    return documents.map(toDomain);
  }

  async list(
    query: EnforcementActionListQuery,
    tx?: Transaction,
  ): Promise<EnforcementActionListResult> {
    const filter = buildListFilter(query);
    const session = toSession(tx);
    const [documents, total] = await Promise.all([
      this.collection
        .find(filter, { session })
        .sort({ created_at: -1 })
        .skip(query.offset)
        .limit(query.limit)
        .toArray(),
      this.collection.countDocuments(filter, { session }),
    ]);
    return { items: documents.map(toDomain), total };
  }
}

function buildListFilter(query: EnforcementActionListQuery): Filter<EnforcementActionDocument> {
  const filter: Record<string, unknown> = {
    organization_id: new ObjectId(query.organizationId),
  };
  if (query.caseId !== undefined) {
    filter.case_id = new ObjectId(query.caseId);
  }
  if (query.status !== undefined) {
    filter.status = query.status;
  }
  if (query.actionType !== undefined) {
    filter.action_type = query.actionType;
  }
  if (query.targetType !== undefined) {
    filter.target_type = query.targetType;
  }
  if (query.targetId !== undefined) {
    filter.target_id = query.targetId;
  }
  return filter as Filter<EnforcementActionDocument>;
}

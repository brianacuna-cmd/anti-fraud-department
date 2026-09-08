import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { RiskScoringRule } from '../../../../domain/model/aggregates/RiskScoringRule.js';
import type { RiskScoringRuleId } from '../../../../domain/model/value-objects/RiskScoringRuleId.js';
import type { RiskScoringRuleRepository } from '../../../../domain/ports/RiskScoringRuleRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { RiskScoringRuleDocument } from './documents/RiskScoringRuleDocument.js';
import { toDocument, toDomain } from './mappers/RiskScoringRuleDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors the sibling repositories). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'risk_scoring_rules';

/**
 * Mongo adapter for `RiskScoringRuleRepository`. Scoring reads ACTIVE rules;
 * draft/activate flows use save/findById/listByOrganization. The unique
 * partial ACTIVE index guarantees at most one ACTIVE per org.
 */
export class MongoRiskScoringRuleRepository implements RiskScoringRuleRepository {
  private readonly collection: Collection<RiskScoringRuleDocument>;

  constructor(db: Db) {
    this.collection = db.collection<RiskScoringRuleDocument>(COLLECTION_NAME);
  }

  async findActiveByOrganization(
    organizationId: string,
    tx?: Transaction,
  ): Promise<readonly RiskScoringRule[]> {
    const documents = await this.collection
      .find(
        { organization_id: new ObjectId(organizationId), status: 'ACTIVE', deleted_at: null },
        { session: toSession(tx) },
      )
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }

  async findById(id: RiskScoringRuleId, tx?: Transaction): Promise<RiskScoringRule | null> {
    const document = await this.collection.findOne(
      { _id: new ObjectId(id), deleted_at: null },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }

  async listByOrganization(organizationId: string, tx?: Transaction): Promise<readonly RiskScoringRule[]> {
    const documents = await this.collection
      .find(
        { organization_id: new ObjectId(organizationId), deleted_at: null },
        { session: toSession(tx) },
      )
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }

  async save(rule: RiskScoringRule, tx?: Transaction): Promise<void> {
    const document = toDocument(rule);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }
}

import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { RiskScoringRule } from '../../../../domain/model/aggregates/RiskScoringRule.js';
import type { RiskScoringRuleRepository } from '../../../../domain/ports/RiskScoringRuleRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { RiskScoringRuleDocument } from './documents/RiskScoringRuleDocument.js';
import { toDomain } from './mappers/RiskScoringRuleDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors the sibling repositories). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'risk_scoring_rules';

/**
 * Mongo adapter for `RiskScoringRuleRepository`. Scoring only reads ACTIVE
 * rules for an organization. The unique partial ACTIVE index guarantees at
 * most one row; `CalculateRiskScore` takes `rules[0]` as that sole ACTIVE.
 * `created_at` ascending remains a stable order if a fake returns more than one.
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
      .find({ organization_id: new ObjectId(organizationId), status: 'ACTIVE' }, { session: toSession(tx) })
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }
}

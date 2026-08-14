import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { CaseRoutingRule } from '../../../../domain/model/aggregates/CaseRoutingRule.js';
import type { CaseRoutingRuleId } from '../../../../domain/model/value-objects/CaseRoutingRuleId.js';
import type { CaseRoutingRuleRepository } from '../../../../domain/ports/CaseRoutingRuleRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseRoutingRuleDocument } from './documents/CaseRoutingRuleDocument.js';
import { toDocument, toDomain } from './mappers/CaseRoutingRuleDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors the sibling repositories). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'case_routing_rules';

/**
 * Mongo adapter for `CaseRoutingRuleRepository`. T1 auto-routing only reads
 * ACTIVE rules for an organization, ordered by `created_at` ascending so
 * `RouteCase`'s first-match-wins semantics are deterministic (oldest rule
 * takes precedence). Draft CRUD uses save/findById/listByOrganization.
 * The `{ organization_id, status }` index stays non-unique (multi-ACTIVE OK).
 */
export class MongoCaseRoutingRuleRepository implements CaseRoutingRuleRepository {
  private readonly collection: Collection<CaseRoutingRuleDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseRoutingRuleDocument>(COLLECTION_NAME);
  }

  async findActiveByOrganization(
    organizationId: string,
    tx?: Transaction,
  ): Promise<readonly CaseRoutingRule[]> {
    const documents = await this.collection
      .find({ organization_id: new ObjectId(organizationId), status: 'ACTIVE' }, { session: toSession(tx) })
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }

  async findById(id: CaseRoutingRuleId, tx?: Transaction): Promise<CaseRoutingRule | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async listByOrganization(organizationId: string, tx?: Transaction): Promise<readonly CaseRoutingRule[]> {
    const documents = await this.collection
      .find({ organization_id: new ObjectId(organizationId) }, { session: toSession(tx) })
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }

  async save(rule: CaseRoutingRule, tx?: Transaction): Promise<void> {
    const document = toDocument(rule);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }
}

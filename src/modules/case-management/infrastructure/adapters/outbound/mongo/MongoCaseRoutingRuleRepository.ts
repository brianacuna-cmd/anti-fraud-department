import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { CaseRoutingRule } from '../../../../domain/model/aggregates/CaseRoutingRule.js';
import type { CaseRoutingRuleRepository } from '../../../../domain/ports/CaseRoutingRuleRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseRoutingRuleDocument } from './documents/CaseRoutingRuleDocument.js';
import { toDomain } from './mappers/CaseRoutingRuleDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors the sibling repositories). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'case_routing_rules';

/**
 * Mongo adapter for `CaseRoutingRuleRepository`. T1 auto-routing only reads
 * ACTIVE rules for an organization, ordered by `created_at` ascending so
 * `RouteCase`'s first-match-wins semantics are deterministic (oldest rule
 * takes precedence). The `{ organization_id, status }` index keeps this off
 * a collection scan.
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
}

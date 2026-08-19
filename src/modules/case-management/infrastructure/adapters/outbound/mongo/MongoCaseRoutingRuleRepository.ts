import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { CaseRoutingRule } from '../../../../domain/model/aggregates/CaseRoutingRule.js';
import type { CaseRoutingRuleRepository } from '../../../../domain/ports/CaseRoutingRuleRepository.js';
import type { CaseRoutingRuleId } from '../../../../domain/model/value-objects/CaseRoutingRuleId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseRoutingRuleDocument } from './documents/CaseRoutingRuleDocument.js';
import { toDocument, toDomain } from './mappers/CaseRoutingRuleDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'CaseRoutingRules';

/**
 * Mongo adapter for `CaseRoutingRuleRepository` (CASE-002).
 *
 * Ordena por `EvaluationOrder` y luego por `_id` en la propia consulta: el
 * evaluador vuelve a ordenar, pero hacerlo aqui tambien mantiene el resultado
 * estable si alguien inspecciona la coleccion a mano para entender por que un
 * caso acabo donde acabo.
 */
export class MongoCaseRoutingRuleRepository implements CaseRoutingRuleRepository {
  private readonly collection: Collection<CaseRoutingRuleDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseRoutingRuleDocument>(COLLECTION_NAME);
  }

  async save(rule: CaseRoutingRule, tx?: Transaction): Promise<void> {
    const document = toDocument(rule);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: CaseRoutingRuleId, tx?: Transaction): Promise<CaseRoutingRule | null> {
    if (!ObjectId.isValid(id)) return null;
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async listActive(organizationId: string, tx?: Transaction): Promise<readonly CaseRoutingRule[]> {
    const documents = await this.collection
      .find({ OrganizationId: organizationId, Status: 'ACTIVE' }, { session: toSession(tx) })
      .sort({ EvaluationOrder: 1, _id: 1 })
      .toArray();
    return documents.map(toDomain);
  }

  async listAll(organizationId: string, tx?: Transaction): Promise<readonly CaseRoutingRule[]> {
    const documents = await this.collection
      .find({ OrganizationId: organizationId }, { session: toSession(tx) })
      .sort({ EvaluationOrder: 1, _id: 1 })
      .toArray();
    return documents.map(toDomain);
  }
}

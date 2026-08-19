import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { Case } from '../../../../domain/model/aggregates/Case.js';
import type {
  CaseListFilter,
  CaseListPage,
  CaseRepository,
  FindCaseByIdentityOptions,
} from '../../../../domain/ports/CaseRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseDocument } from './documents/CaseDocument.js';
import { toDocument, toDomain } from './mappers/CaseDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors identity-access). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'Cases';

/** Mongo adapter for `CaseRepository`. */
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
    if (!ObjectId.isValid(id)) return null;
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findByCustomerOrBridgeId(
    options: FindCaseByIdentityOptions,
    tx?: Transaction,
  ): Promise<Case | null> {
    const { organizationId, customerId, bridgeUserId, statuses } = options;

    const conditions: Record<string, unknown>[] = [];
    if (customerId) {
      conditions.push({ CustomerId: customerId });
      conditions.push({ 'FinturuCacheSnapshot.idUser': customerId });
      // El padrón de Finturu tipa `idUser` como número en unos payloads y como
      // cadena en otros; sin las dos variantes la deduplicación fallaba para la
      // mitad de los clientes y abría un expediente duplicado.
      const numericCustomerId = Number(customerId);
      if (Number.isFinite(numericCustomerId)) {
        conditions.push({ 'FinturuCacheSnapshot.idUser': numericCustomerId });
      }
    }
    if (bridgeUserId) {
      conditions.push({ BridgeUserId: bridgeUserId });
      conditions.push({ 'FinturuCacheSnapshot.idUserBridge': bridgeUserId });
    }
    if (conditions.length === 0) return null;

    // `OrganizationId` NO es opcional. La versión anterior reintentaba la
    // consulta sin él cuando no encontraba nada, de modo que la ingesta podía
    // enganchar —y sobrescribir— el expediente de otro tenant que compartiera
    // identificador de cliente. Un expediente ajeno nunca es una coincidencia
    // válida: si no hay caso en esta organización, corresponde crear uno.
    const filter: Record<string, unknown> = {
      OrganizationId: organizationId,
      $or: conditions,
    };

    if (statuses && statuses.length > 0) {
      filter.Status = { $in: [...statuses] };
    }

    const document = await this.collection.findOne(filter, { session: toSession(tx) });

    return document ? toDomain(document) : null;
  }

  /**
   * Translates CASE-004's filter into one Mongo predicate. Shared by `list`
   * and `countAll` so a listing and its total can never disagree about what
   * "matching" means.
   *
   * `DeletedAt` is excluded unconditionally: soft-deleted cases were showing
   * up in every listing because the original query never mentioned the field.
   */
  private buildFilter(filter: CaseListFilter = {}): Record<string, unknown> {
    const query: Record<string, unknown> = { DeletedAt: null };

    if (filter.organizationId) {
      query.OrganizationId = filter.organizationId;
    }

    const inOrEq = (value: string | readonly string[] | undefined): unknown => {
      if (value === undefined) return undefined;
      const values = (Array.isArray(value) ? value : [value]).filter((v) => v && v !== 'ALL');
      if (values.length === 0) return undefined;
      return values.length === 1 ? values[0] : { $in: values };
    };

    const status = inOrEq(filter.status);
    if (status !== undefined) query.Status = status;

    const priority = inOrEq(filter.priority);
    if (priority !== undefined) query.Priority = priority;

    // 'UNASSIGNED' es la bandeja general, no un tipo de actor: se traduce a
    // "sin asignatario" en lugar de buscar un AssignedToType con ese nombre.
    if (filter.assignedToType === 'UNASSIGNED') {
      query.AssignedTo = null;
    } else {
      if (filter.assignedToId) query.AssignedTo = filter.assignedToId;
      if (filter.assignedToType) query.AssignedToType = filter.assignedToType;
    }

    if (filter.tags && filter.tags.length > 0) {
      query.Tags = { $all: [...filter.tags] };
    }

    if (filter.riskScoreMin !== undefined || filter.riskScoreMax !== undefined) {
      const range: Record<string, number> = {};
      if (filter.riskScoreMin !== undefined) range.$gte = filter.riskScoreMin;
      if (filter.riskScoreMax !== undefined) range.$lte = filter.riskScoreMax;
      query.RiskScore = range;
    }

    // CreatedAt/DueDate se guardan como ISO-8601 UTC, cuyo orden lexicográfico
    // coincide con el cronológico; por eso el rango se compara como cadena y no
    // hace falta un espejo BSON como el de CaseSlaTracking.
    if (filter.createdFrom !== undefined || filter.createdTo !== undefined) {
      const range: Record<string, string> = {};
      if (filter.createdFrom !== undefined) range.$gte = filter.createdFrom;
      if (filter.createdTo !== undefined) range.$lte = filter.createdTo;
      query.CreatedAt = range;
    }

    if (filter.overdueOnly) {
      query.DueDate = { $ne: null, $lt: new Date().toISOString() };
    } else if (filter.dueBefore !== undefined) {
      query.DueDate = { $ne: null, $lte: filter.dueBefore };
    }

    if (filter.search && filter.search.trim().length > 0) {
      const term = filter.search.trim();
      // `escapeRegExp`: un término con caracteres de regex (por ejemplo el '+'
      // de un email con alias) hacía estallar la consulta en vez de buscarlo.
      const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = { $regex: safe, $options: 'i' };
      query.$or = [
        { CustomerId: rx },
        { CustomerEmail: rx },
        { BridgeUserId: rx },
        { BridgeWallet: rx },
        { StripeCustomerId: rx },
      ];
    }

    return query;
  }

  async list(filter: CaseListFilter = {}): Promise<CaseListPage> {
    const limit = filter.limit ?? 50;
    const query = this.buildFilter(filter);

    if (filter.cursor && ObjectId.isValid(filter.cursor)) {
      query._id = { $lt: new ObjectId(filter.cursor) };
    }

    const documents = await this.collection.find(query).sort({ _id: -1 }).limit(limit + 1).toArray();
    const items = documents.slice(0, limit).map(toDomain);
    const nextCursor = documents.length > limit ? documents[limit]._id.toString() : null;
    return { items, nextCursor };
  }

  async countAll(filter: CaseListFilter = {}): Promise<number> {
    return this.collection.countDocuments(this.buildFilter(filter));
  }
}

import { ObjectId, type ClientSession, type Collection, type Db, type Filter } from 'mongodb';
import type { Case } from '../../../../domain/model/aggregates/Case.js';
import type {
  CaseListQuery,
  CaseListResult,
  CaseRepository,
  EntityIdentifierQuery,
  FindCaseByIdentityOptions,
} from '../../../../domain/ports/CaseRepository.js';
import type { EntityNodeType } from '../../../../domain/model/value-objects/EntityNodeType.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseDocument } from './documents/CaseDocument.js';
import { toDocument, toDomain } from './mappers/CaseDocumentMapper.js';
import { toDate } from '../../../../../../shared/time/Instant.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors identity-access). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

/**
 * Campo del documento por el que se busca cada tipo de identificador.
 *
 * `Record<EntityNodeType, ...>` obliga a que el mapa sea TOTAL: si manana se
 * anade un tipo de entidad al catalogo, el build falla aqui hasta que alguien
 * diga en que campo vive. Sin esto la expansion del grafo lo ignoraria en
 * silencio y la red saldria incompleta sin aviso — que es el peor fallo
 * posible en esta funcion, porque un grafo incompleto se parece mucho a un
 * grafo correcto.
 */
const FIELD_BY_ENTITY_TYPE: Record<EntityNodeType, string> = {
  CUSTOMER: 'customer_id',
  EMAIL: 'customer_email',
  WALLET: 'bridge_wallet',
  BRIDGE_USER: 'bridge_user_id',
  STRIPE_CUSTOMER: 'stripe_customer_id',
};

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

  /**
   * CASE-011. `organization_id` NUNCA es opcional: una version anterior
   * reintentaba la consulta sin el cuando no encontraba nada, de modo que la
   * ingesta podia enganchar —y sobrescribir— el expediente de otro inquilino
   * que compartiera identificador de cliente. Un expediente ajeno no es una
   * coincidencia valida: si no hay caso en esta organizacion, toca crear uno.
   *
   * `deleted_at: null` excluye los borrados logicos, para que la ingesta no
   * revuelva un expediente que el equipo ya habia retirado.
   */
  async findByCustomerOrBridgeId(
    options: FindCaseByIdentityOptions,
    tx?: Transaction,
  ): Promise<Case | null> {
    const { organizationId, customerId, bridgeUserId, statuses } = options;

    const conditions: Record<string, unknown>[] = [];
    if (customerId) {
      conditions.push({ customer_id: customerId });
      conditions.push({ 'finturu_cache_snapshot.idUser': customerId });
      // El padron de Finturu tipa `idUser` como numero en unos payloads y como
      // cadena en otros; sin las dos variantes la deduplicacion fallaba para la
      // mitad de los clientes y abria un expediente duplicado.
      const numericCustomerId = Number(customerId);
      if (Number.isFinite(numericCustomerId)) {
        conditions.push({ 'finturu_cache_snapshot.idUser': numericCustomerId });
      }
    }
    if (bridgeUserId) {
      conditions.push({ bridge_user_id: bridgeUserId });
      conditions.push({ 'finturu_cache_snapshot.idUserBridge': bridgeUserId });
    }
    if (conditions.length === 0) return null;

    const filter: Record<string, unknown> = {
      organization_id: new ObjectId(organizationId),
      deleted_at: null,
      $or: conditions,
    };
    if (statuses !== undefined && statuses.length > 0) {
      filter.status = { $in: [...statuses] };
    }

    const document = await this.collection.findOne(filter as Filter<CaseDocument>, {
      session: toSession(tx),
      sort: { created_at: -1 },
    });
    return document ? toDomain(document) : null;
  }

  async findByEntityIdentifiers(
    query: EntityIdentifierQuery,
    tx?: Transaction,
  ): Promise<readonly Case[]> {
    const { organizationId, refs, limit } = query;
    if (refs.length === 0 || limit <= 0) {
      return [];
    }

    // Un $or con una rama por (tipo, valor) crece rapido y Mongo no puede usar
    // un indice por rama repetida. Agrupamos por campo y emitimos un $in por
    // campo: cinco ramas como maximo, cada una indexable.
    const byField = new Map<string, Set<string>>();
    for (const ref of refs) {
      const field = FIELD_BY_ENTITY_TYPE[ref.type];
      const values = byField.get(field) ?? new Set<string>();
      values.add(ref.value);
      byField.set(field, values);
    }

    const conditions = [...byField.entries()].map(([field, values]) => ({
      [field]: { $in: [...values] },
    }));

    const documents = await this.collection
      .find(
        {
          organization_id: new ObjectId(organizationId),
          deleted_at: null,
          $or: conditions,
        } as Filter<CaseDocument>,
        { session: toSession(tx), limit, sort: { created_at: -1 } },
      )
      .toArray();
    return documents.map(toDomain);
  }

  async findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
    tx?: Transaction,
  ): Promise<Case | null> {
    const document = await this.collection.findOne(
      { organization_id: new ObjectId(organizationId), idempotency_key: idempotencyKey },
      { session: toSession(tx) },
    );
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

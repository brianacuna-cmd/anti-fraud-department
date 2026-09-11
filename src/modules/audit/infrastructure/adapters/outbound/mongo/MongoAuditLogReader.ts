import { ObjectId, type Collection, type Db, type Filter } from 'mongodb';
import type { AuditLog } from '../../../../domain/model/aggregates/AuditLog.js';
import type {
  AuditLogFilter,
  AuditLogPage,
  AuditLogPageQuery,
  AuditLogReader,
} from '../../../../domain/ports/AuditLogQuery.js';
import { toDate } from '../../../../../../shared/time/Instant.js';
import type { AuditLogDocument } from './documents/AuditLogDocument.js';
import { toDomain } from './mappers/AuditLogDocumentMapper.js';

const COLLECTION_NAME = 'audit_logs';

/** Cuántas filas trae cada vuelta del cursor durante un export. */
const STREAM_BATCH = 500;

/**
 * Lado de LECTURA sobre `audit_logs`, separado del repositorio append-only.
 *
 * El repositorio declara `save` y nada más, y esa firma es lo que hace
 * creíble la bitácora. Este adaptador consulta sin tocar aquella garantía.
 */
export class MongoAuditLogReader implements AuditLogReader {
  private readonly collection: Collection<AuditLogDocument>;

  constructor(db: Db) {
    this.collection = db.collection<AuditLogDocument>(COLLECTION_NAME);
  }

  async page(query: AuditLogPageQuery): Promise<AuditLogPage> {
    const filter = this.toFilter(query);
    const total = await this.collection.countDocuments(filter);
    const documents = await this.collection
      .find(filter)
      // Del más reciente al más antiguo: quien abre la auditoría casi siempre
      // busca qué acaba de pasar, no cómo empezó todo.
      .sort({ created_at: -1 })
      .skip(query.offset)
      .limit(query.limit)
      .toArray();
    return { items: documents.map(toDomain), total };
  }

  async *stream(filter: AuditLogFilter): AsyncIterable<AuditLog> {
    const cursor = this.collection
      .find(this.toFilter(filter))
      /*
       * Ascendente aquí, al revés que en la página.
       *
       * Un export es un registro cronológico que alguien va a leer de arriba
       * abajo y, sobre todo, sobre el que se calcula una firma: el orden tiene
       * que ser reproducible y natural. Del más nuevo al más viejo sirve para
       * una pantalla, no para un documento que se archiva.
       */
      .sort({ created_at: 1, _id: 1 })
      .batchSize(STREAM_BATCH);

    for await (const document of cursor) {
      yield toDomain(document);
    }
  }

  /** Traduce los filtros de dominio a un filtro de Mongo. */
  private toFilter(f: AuditLogFilter): Filter<AuditLogDocument> {
    const filter: Record<string, unknown> = {};

    /*
     * `organizationId: null` significa PLATAFORMA ENTERA, no "sin inquilino".
     *
     * Son dos cosas distintas y el puerto solo deja pedir la primera a un
     * PLATFORM_ADMIN: si se tradujera a `organization_id: null` se estaría
     * filtrando por las filas que no tienen inquilino —las del propio
     * super admin— en vez de no filtrar, que es justo lo contrario de lo que
     * pide quien audita toda la instalación.
     */
    if (f.organizationId !== null) {
      filter.organization_id = new ObjectId(f.organizationId);
    }

    if (f.actorId !== undefined) filter.actor_id = f.actorId;
    if (f.actorType !== undefined) filter.actor_type = f.actorType;
    if (f.action !== undefined) filter.action = f.action;
    if (f.resource !== undefined) filter.resource = f.resource;
    if (f.resourceId !== undefined) filter.resource_id = f.resourceId;
    if (f.ipAddress !== undefined) filter.ip_address = f.ipAddress;

    if (f.from !== undefined || f.to !== undefined) {
      const range: Record<string, Date> = {};
      if (f.from !== undefined) range.$gte = toDate(f.from);
      if (f.to !== undefined) range.$lte = toDate(f.to);
      filter.created_at = range;
    }

    return filter as Filter<AuditLogDocument>;
  }
}

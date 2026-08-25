import type { Collection, Db } from 'mongodb';
import type {
  FinturuDirectoryEntry,
  FinturuDirectoryPage,
  FinturuDirectoryQuery,
  FinturuDirectoryRepository,
} from '../../../../domain/ports/FinturuDirectoryRepository.js';
import type { FinturuCustomerDocument } from './documents/FinturuCustomerDocument.js';

const COLLECTION_NAME = 'FinturuCustomers';

/** Escapa la entrada del usuario antes de meterla en una regex de Mongo. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchText(entry: FinturuDirectoryEntry): string {
  const walletTerms = entry.wallets.flatMap((wallet) => {
    const w = wallet as { address?: unknown; idWallet?: unknown } | null;
    return [w?.address, w?.idWallet];
  });
  return [
    entry.idUser,
    entry.idUserBridge,
    entry.name,
    entry.lastname,
    entry.email,
    entry.phone,
    entry.idCustomer,
    entry.address,
    ...walletTerms,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function toDomain(document: FinturuCustomerDocument): FinturuDirectoryEntry {
  return {
    idUser: document.IdUser,
    idUserBridge: document.IdUserBridge,
    name: document.Name,
    lastname: document.Lastname,
    email: document.Email,
    phone: document.Phone,
    status: document.Status,
    address: document.Address,
    idCustomer: document.IdCustomer,
    wallets: document.Wallets,
    transfers: document.Transfers,
    stripe: document.Stripe,
    riskScore: document.RiskScore,
  };
}

export class MongoFinturuDirectoryRepository implements FinturuDirectoryRepository {
  private readonly collection: Collection<FinturuCustomerDocument>;

  constructor(db: Db) {
    this.collection = db.collection<FinturuCustomerDocument>(COLLECTION_NAME);
  }

  /**
   * Upsert de todo el lote y borrado de lo que quedó atrás. Se marca cada
   * documento con `SyncedAt`; al terminar se eliminan los que conserven una
   * marca anterior, que son justamente los clientes que ya no existen en
   * origen. Evita un `deleteMany` previo, que dejaría el directorio vacío
   * durante los minutos que dura el sync.
   */
  async replaceAll(entries: readonly FinturuDirectoryEntry[], syncedAt: string): Promise<void> {
    // Un lote vacío casi siempre significa "el origen falló", no "ya no hay
    // clientes". Borrar el directorio entero por eso sería destruir la única
    // copia buena que queda.
    if (entries.length === 0) return;

    await this.collection.bulkWrite(
      entries.map((entry) => ({
        updateOne: {
          filter: { _id: entry.idUser },
          update: {
            $set: {
              IdUser: entry.idUser,
              IdUserBridge: entry.idUserBridge,
              Name: entry.name,
              Lastname: entry.lastname,
              Email: entry.email,
              Phone: entry.phone,
              Status: entry.status,
              Address: entry.address,
              IdCustomer: entry.idCustomer,
              Wallets: entry.wallets,
              Transfers: entry.transfers,
              Stripe: entry.stripe,
              RiskScore: entry.riskScore,
              SearchText: buildSearchText(entry),
              SyncedAt: syncedAt,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );

    await this.collection.deleteMany({ SyncedAt: { $lt: syncedAt } });
  }

  async page(query: FinturuDirectoryQuery): Promise<FinturuDirectoryPage> {
    const filter: Record<string, unknown> = {};

    const search = query.search?.trim().toLowerCase();
    if (search) {
      filter.SearchText = { $regex: escapeRegex(search) };
    }

    const [documents, total, syncedAt] = await Promise.all([
      this.collection
        .find(filter)
        // Los de mayor riesgo primero: es el orden en el que un analista quiere leerlos.
        .sort({ RiskScore: -1, Name: 1 })
        .skip(query.offset)
        .limit(query.limit)
        .toArray(),
      this.collection.countDocuments(filter),
      this.lastSyncedAt(),
    ]);

    return { items: documents.map(toDomain), total, syncedAt };
  }

  async lastSyncedAt(): Promise<string | null> {
    const document = await this.collection.findOne({}, { sort: { SyncedAt: -1 }, projection: { SyncedAt: 1 } });
    return document?.SyncedAt ?? null;
  }
}

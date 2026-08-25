import type { Clock } from '../../../../../../shared/time/Clock.js';
import type {
  FinturuCustomerKeys,
  FinturuDirectoryEntry,
  FinturuDirectoryPage,
  FinturuDirectoryQuery,
  FinturuDirectoryRepository,
} from '../../../../domain/ports/FinturuDirectoryRepository.js';
import type { FinturuApiClient } from './FinturuApiClient.js';
import { composeFinturuDirectory } from './composeFinturuDirectory.js';

/** Ventana durante la que se reutiliza una composición ya hecha. */
const DEFAULT_TTL_MS = 60_000;

/** Todos los campos buscables concatenados: una sola pasada los cubre. */
function searchTextOf(entry: FinturuDirectoryEntry): string {
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

interface Snapshot {
  readonly entries: readonly FinturuDirectoryEntry[];
  /** Índice de búsqueda paralelo a `entries`, precalculado una vez por composición. */
  readonly searchText: readonly string[];
  /** `idUser`, `idUserBridge` y correo → entrada, para la búsqueda exacta de la ficha. */
  readonly byKey: ReadonlyMap<string, FinturuDirectoryEntry>;
  readonly composedAt: string;
  readonly expiresAt: number;
}

function indexByKey(entries: readonly FinturuDirectoryEntry[]): Map<string, FinturuDirectoryEntry> {
  const index = new Map<string, FinturuDirectoryEntry>();
  for (const entry of entries) {
    index.set(entry.idUser, entry);
    if (entry.idUserBridge) index.set(entry.idUserBridge, entry);
    if (entry.email) index.set(entry.email.trim().toLowerCase(), entry);
  }
  return index;
}

export interface FinturuLiveDirectoryOptions {
  readonly client: FinturuApiClient;
  readonly clock: Clock;
  readonly ttlMs?: number;
}

/**
 * El directorio de clientes, compuesto en vivo desde Finturu y NUNCA
 * persistido.
 *
 * Sustituye a `MongoFinturuDirectoryRepository`, que mantenía una copia local
 * de los 1600 clientes con nombre, correo, teléfono, dirección, billeteras y
 * movimientos. Esa copia existía por una razón que ya no se cumple: componer
 * el padrón recorriendo Bridge costaba unos tres minutos. Ahora Finturu lo
 * sirve desde su propia base de datos y la composición entera —clientes,
 * billeteras, transferencias y Stripe— cuesta alrededor de un segundo y medio,
 * así que guardarla solo aportaba una segunda copia de datos personales que
 * mantener sincronizada, proteger y borrar.
 *
 * Dos consecuencias que el diseño tiene que absorber:
 *
 *  1. **Finturu no filtra.** `/customers` ignora `search`, `limit` y `offset`
 *     y devuelve el padrón entero, así que la búsqueda y la paginación se
 *     resuelven aquí, en memoria. Con 1600 filas es intrascendente; si el
 *     padrón creciera un orden de magnitud, esto es lo primero que hay que
 *     mover al origen.
 *  2. **Componer no es gratis.** Una caché en memoria con TTL corto convierte
 *     N peticiones de N analistas en una sola vuelta a Finturu por ventana.
 *     Vive en el proceso y muere con él: no hay nada que purgar ni que cifrar
 *     en reposo, que es justamente el objetivo.
 */
export class FinturuLiveDirectory implements FinturuDirectoryRepository {
  private readonly ttlMs: number;
  private snapshot: Snapshot | null = null;
  /**
   * Composición en curso.
   *
   * Sin esto, la primera carga tras expirar el TTL dispara tantas
   * composiciones como peticiones lleguen a la vez —y la pantalla del
   * directorio lanza una por tecla—. De un solo vuelo: quien llega mientras
   * hay una en marcha se engancha a ella.
   */
  private inFlight: Promise<Snapshot> | null = null;

  constructor(private readonly options: FinturuLiveDirectoryOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  private async load(): Promise<Snapshot> {
    const cached = this.snapshot;
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = (async () => {
      /*
       * `/stripe/transfers` no se pide: devuelve 404 en el Finturu actual y el
       * cliente HTTP degrada los fallos a lista vacía, así que era una vuelta
       * de red por composición para obtener siempre nada.
       */
      const [customers, wallets, transfers, stripeCustomers] = await Promise.all([
        this.options.client.getCustomers(),
        this.options.client.getWallets(),
        this.options.client.getTransfers(),
        this.options.client.getStripeCustomers(),
      ]);

      const entries = composeFinturuDirectory({ customers, wallets, transfers, stripeCustomers });
      return {
        entries,
        searchText: entries.map(searchTextOf),
        byKey: indexByKey(entries),
        composedAt: this.options.clock.now(),
        expiresAt: Date.now() + this.ttlMs,
      } satisfies Snapshot;
    })();

    try {
      const fresh = await this.inFlight;
      this.snapshot = fresh;
      return fresh;
    } catch (error) {
      /*
       * Si Finturu falla y hay una composición anterior, se sirve esa antes
       * que vaciar la pantalla: el directorio es una vista de consulta y un
       * padrón de hace dos minutos es infinitamente más útil que un error.
       */
      if (cached) return cached;
      throw error;
    } finally {
      this.inFlight = null;
    }
  }

  async page(query: FinturuDirectoryQuery): Promise<FinturuDirectoryPage> {
    const snapshot = await this.load();
    const term = query.search?.trim().toLowerCase() ?? '';

    const matched =
      term === ''
        ? snapshot.entries
        : snapshot.entries.filter((_, i) => snapshot.searchText[i]!.includes(term));

    return {
      items: matched.slice(query.offset, query.offset + query.limit),
      total: matched.length,
      // Lo que antes era «cuándo se sincronizó» es ahora «cuándo se compuso».
      // El campo se conserva porque la pantalla lo muestra, y sigue diciendo
      // exactamente lo mismo: la antigüedad de lo que estás viendo.
      syncedAt: snapshot.composedAt,
    };
  }

  async findByCustomer(keys: FinturuCustomerKeys): Promise<FinturuDirectoryEntry | null> {
    const snapshot = await this.load();
    const candidates = [keys.idUser, keys.idUserBridge, keys.email?.trim().toLowerCase()];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const hit = snapshot.byKey.get(candidate);
      if (hit) return hit;
    }
    return null;
  }

  async lastSyncedAt(): Promise<string | null> {
    return this.snapshot?.composedAt ?? null;
  }
}

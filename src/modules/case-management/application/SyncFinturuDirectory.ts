import type { Clock } from '../../../shared/time/Clock.js';
import type {
  FinturuApiClient,
  FinturuStripeCustomerDto,
  FinturuStripeTransferDto,
  FinturuTransferDto,
  FinturuWalletDto,
} from '../infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import type {
  FinturuDirectoryEntry,
  FinturuDirectoryRepository,
} from '../domain/ports/FinturuDirectoryRepository.js';

export interface SyncFinturuDirectoryResult {
  readonly total: number;
  readonly syncedAt: string;
  readonly durationMs: number;
}

export interface SyncFinturuDirectoryDeps {
  readonly finturuClient: FinturuApiClient;
  readonly directory: FinturuDirectoryRepository;
  readonly clock: Clock;
}

function readExactKey(bag: Record<string, unknown> | undefined, key: string): string | null {
  const value = bag?.[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** `bridgeWalletId` -> `bridge_wallet_id`. */
function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Lee una clave de correlacion de un objeto sin contrato (`metadata` de Stripe,
 * `source`/`destination` de un transfer). Devuelve `null` si falta, para que el
 * llamante nunca compare `undefined` contra un Set.
 *
 * Acepta numero ademas de texto: el padron de Finturu tipa el MISMO campo como
 * numero en unos payloads y como cadena en otros, y descartar la variante
 * numerica dejaria sin correlacionar a la mitad de los clientes.
 *
 * Y prueba tambien la variante `snake_case`: Finturu normaliza a camelCase la
 * capa exterior del transfer (`idTransfer`, `clientReferenceId`) pero reenvia
 * `source`/`destination` tal cual llegan de Bridge, donde las claves son
 * `bridge_wallet_id`, `from_address` y `to_address`. Buscar solo en camelCase
 * hacia que NINGUN transfer casara con su cliente: el directorio guardaba
 * `transfers: []` para todo el padron y la pestana Movimientos salia vacia.
 */
function readKey(bag: Record<string, unknown> | undefined, key: string): string | null {
  const snake = toSnakeCase(key);
  return readExactKey(bag, key) ?? (snake === key ? null : readExactKey(bag, snake));
}

function riskFor(status: string | undefined, transfers: readonly FinturuTransferDto[]): number {
  let score = 40;
  if (status === 'suspended' || status === 'blocked') score += 50;
  if (transfers.some((t) => t.state === 'failed' || t.state === 'returned')) score += 25;
  if (transfers.length > 5) score += 15;
  return Math.min(Math.max(score, 10), 99);
}

/**
 * Refresca la copia local del directorio de clientes.
 *
 * Recorre los listados completos de Finturu (clientes, billeteras,
 * transferencias y Stripe), los correlaciona en memoria y sustituye el
 * directorio de la organización. Tarda varios minutos porque Bridge es lento,
 * y ese es justamente el motivo de que exista: se paga una vez en segundo
 * plano en lugar de en cada carga de pantalla.
 *
 * A diferencia de `SyncFinturuData`, NO crea expedientes: alimenta solo el
 * directorio. Abrir un caso sigue siendo una decisión explícita de un analista.
 */
export function createSyncFinturuDirectoryUseCase(deps: SyncFinturuDirectoryDeps) {
  return async function syncFinturuDirectory(): Promise<SyncFinturuDirectoryResult> {
    const startedAt = Date.now();

    const [customers, wallets, transfers, stripeCustomers, stripeTransfers] = await Promise.all([
      deps.finturuClient.getCustomers(),
      deps.finturuClient.getWallets(),
      deps.finturuClient.getTransfers(),
      deps.finturuClient.getStripeCustomers(),
      deps.finturuClient.getStripeTransfers(),
    ]);

    const walletsByUser = new Map<string, FinturuWalletDto[]>();
    for (const wallet of wallets) {
      const key = wallet.customerId ?? '';
      if (!key) continue;
      const list = walletsByUser.get(key) ?? [];
      list.push(wallet);
      walletsByUser.set(key, list);
    }

    const stripeByEmail = new Map<string, FinturuStripeCustomerDto>();
    const stripeByIdUser = new Map<string, FinturuStripeCustomerDto>();
    const stripeByIdUserBridge = new Map<string, FinturuStripeCustomerDto>();
    for (const sc of stripeCustomers) {
      if (sc.email) stripeByEmail.set(String(sc.email).trim().toLowerCase(), sc);
      const meta = sc.metadata;
      if (meta && typeof meta === 'object') {
        for (const key of ['idUser', 'userId'] as const) {
          const value = readKey(meta, key);
          if (value) stripeByIdUser.set(value, sc);
        }
        for (const key of ['idUserBridge', 'bridgeUserId'] as const) {
          const value = readKey(meta, key);
          if (value) stripeByIdUserBridge.set(value, sc);
        }
        const metaEmail = readKey(meta, 'email');
        if (metaEmail) stripeByEmail.set(metaEmail.toLowerCase(), sc);
      }
    }

    const stripeTransfersByCustomer = new Map<string, FinturuStripeTransferDto[]>();
    for (const st of stripeTransfers) {
      const key = st.customerId ?? '';
      if (!key) continue;
      const list = stripeTransfersByCustomer.get(key) ?? [];
      list.push(st);
      stripeTransfersByCustomer.set(key, list);
    }

    const entries: FinturuDirectoryEntry[] = [];

    for (const customer of customers) {
      const bridgeUserId = customer.idUserBridge ? String(customer.idUserBridge).trim() : '';
      const email = customer.email ? String(customer.email).trim().toLowerCase() : '';
      const idUser = customer.idUser ? String(customer.idUser).trim() : bridgeUserId;

      // Sin identificador estable no hay clave con la que persistirlo.
      if (!idUser) continue;

      const userWallets = bridgeUserId ? walletsByUser.get(bridgeUserId) ?? [] : [];
      const walletIds = new Set(userWallets.map((w) => w.idWallet).filter(Boolean));
      const walletAddresses = new Set(
        userWallets.map((w) => String(w.address ?? '').toLowerCase()).filter(Boolean),
      );

      const userTransfers = transfers.filter((t) => {
        // Bridge lo llama `on_behalf_of` y el mapeo de Finturu no lo renombra,
        // asi que leerlo solo como `onBehalfOf` no encontraba nunca al titular.
        const onBehalfOf = t.onBehalfOf ?? readKey(t as Record<string, unknown>, 'onBehalfOf');
        if (bridgeUserId && onBehalfOf === bridgeUserId) return true;

        const sourceWallet = readKey(t.source, 'bridgeWalletId');
        const destinationWallet = readKey(t.destination, 'bridgeWalletId');
        if (sourceWallet && walletIds.has(sourceWallet)) return true;
        if (destinationWallet && walletIds.has(destinationWallet)) return true;

        const fromAddress = readKey(t.source, 'fromAddress');
        const toAddress = readKey(t.destination, 'toAddress');
        if (fromAddress && walletAddresses.has(fromAddress.toLowerCase())) return true;
        if (toAddress && walletAddresses.has(toAddress.toLowerCase())) return true;

        return false;
      });

      const stripeData =
        (email ? stripeByEmail.get(email) : null) ??
        (idUser ? stripeByIdUser.get(idUser) : null) ??
        (bridgeUserId ? stripeByIdUserBridge.get(bridgeUserId) : null) ??
        null;

      const stripeCustomerId = stripeData?.idCustomer ?? stripeData?.id ?? customer.idCustomer ?? null;

      entries.push({
        idUser,
        idUserBridge: customer.idUserBridge ?? null,
        name: customer.name ?? null,
        lastname: customer.lastname ?? null,
        email: customer.email ?? null,
        phone: customer.phone ?? null,
        status: customer.status ?? 'active',
        address: userWallets[0]?.address ?? null,
        idCustomer: stripeCustomerId,
        wallets: userWallets,
        transfers: userTransfers,
        stripe: stripeData
          ? {
              ...stripeData,
              idCustomer: stripeCustomerId,
              transfers: stripeCustomerId ? stripeTransfersByCustomer.get(stripeCustomerId) ?? [] : [],
            }
          : null,
        riskScore: riskFor(customer.status, userTransfers),
      });
    }

    const syncedAt = deps.clock.now();
    await deps.directory.replaceAll(entries, syncedAt);

    return { total: entries.length, syncedAt, durationMs: Date.now() - startedAt };
  };
}

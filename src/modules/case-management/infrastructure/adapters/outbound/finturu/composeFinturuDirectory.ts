import type {
  FinturuCustomerDto,
  FinturuStripeCustomerDto,
  FinturuTransferDto,
  FinturuWalletDto,
} from './FinturuApiClient.js';
import type { FinturuDirectoryEntry } from '../../../../domain/ports/FinturuDirectoryRepository.js';

/**
 * Cruza los listados de Finturu y produce el directorio.
 *
 * Vivía dentro de `SyncFinturuDirectory`, mezclado con la escritura en Mongo.
 * Se extrajo al dejar de persistirse el padrón: lo que era el cuerpo de un
 * proceso por lotes es ahora la composición que sirve cada lectura, y separarlo
 * de la E/S es lo que permite probar la correlación —que es la parte con
 * enjundia— sin API ni base de datos delante.
 *
 * Es una función pura y CARA en CPU (recorre transferencias por cliente); el
 * llamante decide cada cuánto la ejecuta. Ver `FinturuLiveDirectory`.
 */

/**
 * Lee una clave de correlacion de un objeto sin contrato (`metadata` de Stripe,
 * `source`/`destination` de un transfer). Devuelve `null` si falta, para que el
 * llamante nunca compare `undefined` contra un Set.
 *
 * Acepta numero ademas de texto: el padron de Finturu tipa el MISMO campo como
 * numero en unos payloads y como cadena en otros, y descartar la variante
 * numerica dejaria sin correlacionar a la mitad de los clientes.
 */
function readKey(bag: Record<string, unknown> | undefined, key: string): string | null {
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

function riskFor(status: string | undefined, transfers: readonly FinturuTransferDto[]): number {
  let score = 40;
  if (status === 'suspended' || status === 'blocked') score += 50;
  if (transfers.some((t) => t.state === 'failed' || t.state === 'returned')) score += 25;
  if (transfers.length > 5) score += 15;
  return Math.min(Math.max(score, 10), 99);
}

export interface FinturuDirectorySources {
  readonly customers: readonly FinturuCustomerDto[];
  readonly wallets: readonly FinturuWalletDto[];
  readonly transfers: readonly FinturuTransferDto[];
  readonly stripeCustomers: readonly FinturuStripeCustomerDto[];
}

function indexWalletsByUser(
  wallets: readonly FinturuWalletDto[],
): Map<string, FinturuWalletDto[]> {
  const index = new Map<string, FinturuWalletDto[]>();
  for (const wallet of wallets) {
    const key = wallet.customerId ?? '';
    if (!key) continue;
    const list = index.get(key) ?? [];
    list.push(wallet);
    index.set(key, list);
  }
  return index;
}

interface StripeIndex {
  readonly byEmail: Map<string, FinturuStripeCustomerDto>;
  readonly byIdUser: Map<string, FinturuStripeCustomerDto>;
  readonly byIdUserBridge: Map<string, FinturuStripeCustomerDto>;
}

/**
 * Stripe no comparte identificador con Bridge, así que el cruce va por donde
 * se pueda. Hay dos generaciones de enganche y se indexan las dos:
 *
 *  - `idUserFinturu` y `userInfo` — el bueno. Api-business los resuelve desde
 *    la relación con el usuario, así que vienen poblados.
 *  - `email` de primer nivel y `metadata` — el heredado. Ambos salen de
 *    `account.requestBody`, que hoy está vacío para todas las cuentas: por eso
 *    `name`, `email` y `metadata` llegan nulos, y `balance`, `currency` y
 *    `livemode` son los valores por defecto del mapper y no datos reales. Se
 *    siguen indexando porque no cuesta nada y porque el día que `requestBody`
 *    se llene volverán a servir.
 */
function indexStripe(customers: readonly FinturuStripeCustomerDto[]): StripeIndex {
  const byEmail = new Map<string, FinturuStripeCustomerDto>();
  const byIdUser = new Map<string, FinturuStripeCustomerDto>();
  const byIdUserBridge = new Map<string, FinturuStripeCustomerDto>();

  const remember = (index: Map<string, FinturuStripeCustomerDto>, value: unknown, sc: FinturuStripeCustomerDto) => {
    if (typeof value === 'number' && Number.isFinite(value)) index.set(String(value), sc);
    if (typeof value === 'string' && value.trim() !== '') index.set(value.trim(), sc);
  };

  for (const sc of customers) {
    // Enganche directo. `idUserFinturu` llega como número en unos payloads y
    // como cadena en otros, igual que el `idUser` del padrón.
    remember(byIdUser, sc.idUserFinturu, sc);
    remember(byIdUser, sc.userInfo?.idUser, sc);
    if (sc.userInfo?.email) byEmail.set(sc.userInfo.email.trim().toLowerCase(), sc);

    // Enganche heredado.
    if (sc.email) byEmail.set(String(sc.email).trim().toLowerCase(), sc);
    const meta = sc.metadata;
    if (!meta || typeof meta !== 'object') continue;

    for (const key of ['idUser', 'userId'] as const) {
      const value = readKey(meta, key);
      if (value) byIdUser.set(value, sc);
    }
    for (const key of ['idUserBridge', 'bridgeUserId'] as const) {
      const value = readKey(meta, key);
      if (value) byIdUserBridge.set(value, sc);
    }
    const metaEmail = readKey(meta, 'email');
    if (metaEmail) byEmail.set(metaEmail.toLowerCase(), sc);
  }

  return { byEmail, byIdUser, byIdUserBridge };
}

interface TransferIndex {
  readonly byOnBehalfOf: Map<string, FinturuTransferDto[]>;
  readonly byWalletId: Map<string, FinturuTransferDto[]>;
  readonly byAddress: Map<string, FinturuTransferDto[]>;
}

/**
 * Las transferencias se indexan UNA vez por las tres claves con las que un
 * cliente puede reclamarlas, en lugar de recorrer la lista entera por cada
 * cliente. Con 1600 clientes y ~20 000 transferencias, el filtro anidado que
 * había aquí eran 32 millones de comparaciones por composición: aceptable una
 * vez cada varias horas en un proceso por lotes, no en el camino de una
 * petición.
 */
function indexTransfers(transfers: readonly FinturuTransferDto[]): TransferIndex {
  const byOnBehalfOf = new Map<string, FinturuTransferDto[]>();
  const byWalletId = new Map<string, FinturuTransferDto[]>();
  const byAddress = new Map<string, FinturuTransferDto[]>();

  const push = (
    index: Map<string, FinturuTransferDto[]>,
    key: string | null,
    value: FinturuTransferDto,
  ) => {
    if (!key) return;
    const list = index.get(key) ?? [];
    list.push(value);
    index.set(key, list);
  };

  for (const transfer of transfers) {
    push(byOnBehalfOf, transfer.onBehalfOf ?? null, transfer);
    push(byWalletId, readKey(transfer.source, 'bridgeWalletId'), transfer);
    push(byWalletId, readKey(transfer.destination, 'bridgeWalletId'), transfer);
    push(byAddress, readKey(transfer.source, 'fromAddress')?.toLowerCase() ?? null, transfer);
    push(byAddress, readKey(transfer.destination, 'toAddress')?.toLowerCase() ?? null, transfer);
  }

  return { byOnBehalfOf, byWalletId, byAddress };
}

/**
 * Los movimientos de un cliente. Un mismo transfer puede llegar por varias
 * claves —el wallet de origen Y el de destino son suyos—, así que el Set lo
 * deja en uno.
 */
function transfersFor(
  index: TransferIndex,
  bridgeUserId: string,
  wallets: readonly FinturuWalletDto[],
): FinturuTransferDto[] {
  const found = new Set<FinturuTransferDto>();

  for (const t of bridgeUserId ? index.byOnBehalfOf.get(bridgeUserId) ?? [] : []) {
    found.add(t);
  }
  for (const wallet of wallets) {
    for (const t of wallet.idWallet ? index.byWalletId.get(wallet.idWallet) ?? [] : []) {
      found.add(t);
    }
    const address = wallet.address ? String(wallet.address).toLowerCase() : '';
    for (const t of address ? index.byAddress.get(address) ?? [] : []) {
      found.add(t);
    }
  }

  return [...found];
}

export function composeFinturuDirectory(sources: FinturuDirectorySources): FinturuDirectoryEntry[] {
  const walletsByUser = indexWalletsByUser(sources.wallets);
  const stripe = indexStripe(sources.stripeCustomers);
  const transferIndex = indexTransfers(sources.transfers);

  const entries: FinturuDirectoryEntry[] = [];

  for (const customer of sources.customers) {
    const bridgeUserId = customer.idUserBridge ? String(customer.idUserBridge).trim() : '';
    const email = customer.email ? String(customer.email).trim().toLowerCase() : '';
    const idUser = customer.idUser ? String(customer.idUser).trim() : bridgeUserId;

    // Sin identificador estable no hay clave con la que referirse a él.
    if (!idUser) continue;

    const wallets = bridgeUserId ? walletsByUser.get(bridgeUserId) ?? [] : [];
    const transfers = transfersFor(transferIndex, bridgeUserId, wallets);

    const stripeData =
      (email ? stripe.byEmail.get(email) : null) ??
      stripe.byIdUser.get(idUser) ??
      (bridgeUserId ? stripe.byIdUserBridge.get(bridgeUserId) : null) ??
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
      address: wallets[0]?.address ?? null,
      idCustomer: stripeCustomerId,
      wallets,
      transfers,
      /*
       * `transfers` sale SIEMPRE vacío y no es un descuido: el endpoint
       * `/stripe/transfers` que lo alimentaba devuelve 404 en el Finturu
       * actual. El cliente HTTP degrada los fallos a lista vacía, así que
       * llevaba tiempo escribiéndose en blanco sin que nadie lo notara. Se
       * deja el campo —el frontend lo lee— pero sin la llamada muerta que
       * fingía traerlo.
       */
      stripe: stripeData ? { ...stripeData, idCustomer: stripeCustomerId, transfers: [] } : null,
      riskScore: riskFor(customer.status, transfers),
    });
  }

  return entries;
}

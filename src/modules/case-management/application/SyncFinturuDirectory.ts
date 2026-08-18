import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { FinturuApiClient } from '../infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import type {
  FinturuDirectoryEntry,
  FinturuDirectoryRepository,
} from '../domain/ports/FinturuDirectoryRepository.js';

export interface SyncFinturuDirectoryInput {
  readonly auth?: AuthContext;
}

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

function riskFor(status: string | undefined, transfers: readonly any[]): number {
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
  return async function syncFinturuDirectory(
    _input: SyncFinturuDirectoryInput = {},
  ): Promise<SyncFinturuDirectoryResult> {
    const startedAt = Date.now();

    const [customers, wallets, transfers, stripeCustomers, stripeTransfers] = await Promise.all([
      deps.finturuClient.getCustomers(),
      deps.finturuClient.getWallets(),
      deps.finturuClient.getTransfers(),
      deps.finturuClient.getStripeCustomers(),
      deps.finturuClient.getStripeTransfers(),
    ]);

    const walletsByUser = new Map<string, any[]>();
    for (const wallet of wallets as any[]) {
      const key = wallet.customerId ?? '';
      if (!key) continue;
      const list = walletsByUser.get(key) ?? [];
      list.push(wallet);
      walletsByUser.set(key, list);
    }

    const stripeByEmail = new Map<string, any>();
    const stripeByIdUser = new Map<string, any>();
    const stripeByIdUserBridge = new Map<string, any>();
    for (const sc of stripeCustomers as any[]) {
      if (sc.email) stripeByEmail.set(String(sc.email).trim().toLowerCase(), sc);
      const meta = sc.metadata;
      if (meta && typeof meta === 'object') {
        if (meta.idUser) stripeByIdUser.set(String(meta.idUser).trim(), sc);
        if (meta.userId) stripeByIdUser.set(String(meta.userId).trim(), sc);
        if (meta.idUserBridge) stripeByIdUserBridge.set(String(meta.idUserBridge).trim(), sc);
        if (meta.bridgeUserId) stripeByIdUserBridge.set(String(meta.bridgeUserId).trim(), sc);
        if (meta.email) stripeByEmail.set(String(meta.email).trim().toLowerCase(), sc);
      }
    }

    const stripeTransfersByCustomer = new Map<string, any[]>();
    for (const st of stripeTransfers as any[]) {
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

      const userTransfers = (transfers as any[]).filter((t) => {
        if (bridgeUserId && t.onBehalfOf === bridgeUserId) return true;
        if (t.source?.bridgeWalletId && walletIds.has(t.source.bridgeWalletId)) return true;
        if (t.destination?.bridgeWalletId && walletIds.has(t.destination.bridgeWalletId)) return true;
        if (t.source?.fromAddress && walletAddresses.has(String(t.source.fromAddress).toLowerCase())) return true;
        if (t.destination?.toAddress && walletAddresses.has(String(t.destination.toAddress).toLowerCase())) return true;
        return false;
      });

      const stripeData =
        (email ? stripeByEmail.get(email) : null) ??
        (idUser ? stripeByIdUser.get(idUser) : null) ??
        (bridgeUserId ? stripeByIdUserBridge.get(bridgeUserId) : null) ??
        null;

      const stripeCustomerId = stripeData?.idCustomer ?? stripeData?.id ?? (customer as any).idCustomer ?? null;

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

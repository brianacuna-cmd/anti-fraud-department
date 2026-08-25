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

/**
 * Reads a correlation key from an untyped object (Stripe `metadata`,
 * a transfer's `source`/`destination`). Returns `null` if missing, so the
 * caller never compares `undefined` against a Set.
 *
 * Accepts a number as well as text: Finturu's register types the SAME field
 * as a number in some payloads and as a string in others, and discarding the
 * numeric variant would leave half the customers uncorrelated.
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

/**
 * Refreshes the local copy of the customer directory.
 *
 * Walks Finturu's full listings (customers, wallets, transfers, and Stripe),
 * correlates them in memory, and replaces the organization directory. It
 * takes several minutes because Bridge is slow, and that is exactly why it
 * exists: the cost is paid once in the background instead of on every
 * screen load.
 *
 * Unlike `SyncFinturuData`, it does NOT create cases: it only feeds the
 * directory. Opening a case remains an explicit analyst decision.
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

      // Without a stable identifier there is no key to persist it with.
      if (!idUser) continue;

      const userWallets = bridgeUserId ? walletsByUser.get(bridgeUserId) ?? [] : [];
      const walletIds = new Set(userWallets.map((w) => w.idWallet).filter(Boolean));
      const walletAddresses = new Set(
        userWallets.map((w) => String(w.address ?? '').toLowerCase()).filter(Boolean),
      );

      const userTransfers = transfers.filter((t) => {
        if (bridgeUserId && t.onBehalfOf === bridgeUserId) return true;

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

import type {
  FinturuApiClient,
  FinturuStripeCustomerDto,
  FinturuStripeTransferDto,
  FinturuTransferDto,
  FinturuWalletDto,
} from './FinturuApiClient.js';
import type {
  FinturuDirectoryEntry,
  FinturuDirectoryPage,
  FinturuDirectoryQuery,
  FinturuDirectoryRepository,
} from '../../../../domain/ports/FinturuDirectoryRepository.js';
import { readKey } from '../../../../application/finturuCorrelationKeys.js';

function riskFor(status: string | undefined, transfers: readonly FinturuTransferDto[]): number {
  let score = 40;
  if (status === 'suspended' || status === 'blocked') score += 50;
  if (transfers.some((t) => t.state === 'failed' || t.state === 'returned')) score += 25;
  if (transfers.length > 5) score += 15;
  return Math.min(Math.max(score, 10), 99);
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

/**
 * Composes the directory fresh from `FinturuApiClient` on every call instead
 * of reading a materialized Mongo copy.
 *
 * `customers`/`transfers` (and, via `WalletCustomerService.getAllWallets`,
 * the bulk wallet listing) are DB-backed on the `api-business` side now —
 * that is what makes computing this on demand viable. It was never viable
 * against live Bridge (the old `SyncFinturuDirectory` measured ~3 min for a
 * full walk), which is exactly why that use case and its Mongo copy existed.
 * Only the Stripe correlation (`getStripeCustomers`/`getStripeTransfers`)
 * still calls Stripe live — a single capped `list({ limit: 100 })` each,
 * not a paginated walk, so it was never the source of the overload.
 *
 * `replaceAll` is a no-op: there is nothing to materialize anymore.
 * `lastSyncedAt`/`page().syncedAt` report "now" on every call, honestly —
 * there is no staleness to report.
 */
/**
 * How long a built directory stays good enough to reuse.
 *
 * Every `page()` call used to recompute the whole thing from scratch — fine
 * for one request, but a paginator click or a search keystroke fires one of
 * these every time, and each rebuild is a full customer×wallet×transfer×
 * Stripe correlation. That is what made the panel feel like it "stuck" on
 * the previous page: the click landed, the fetch was just slow. 8s is short
 * enough that data entered in the last few seconds still shows up almost
 * immediately (create a case, refresh the panel), long enough that a burst
 * of clicks/keystrokes reuses one build instead of paying for each of them.
 */
const CACHE_TTL_MS = 8_000;

export class LiveFinturuDirectoryRepository implements FinturuDirectoryRepository {
  private cached: { entries: FinturuDirectoryEntry[]; builtAt: number } | null = null;
  private inFlight: Promise<FinturuDirectoryEntry[]> | null = null;

  constructor(private readonly finturuClient: FinturuApiClient) {}

  async replaceAll(): Promise<void> {
    // Nothing to persist: the directory is composed fresh on every read.
  }

  async lastSyncedAt(): Promise<string | null> {
    return new Date(this.cached?.builtAt ?? Date.now()).toISOString();
  }

  /**
   * Returns the cached build if it's still fresh; otherwise rebuilds.
   * Concurrent callers during a rebuild share the same in-flight promise —
   * a page load and its Stripe-status effect landing in the same tick
   * should not trigger two full correlations.
   */
  private async entries(): Promise<FinturuDirectoryEntry[]> {
    if (this.cached && Date.now() - this.cached.builtAt < CACHE_TTL_MS) {
      return this.cached.entries;
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.buildEntries().then((entries) => {
      this.cached = { entries, builtAt: Date.now() };
      this.inFlight = null;
      return entries;
    }, (error) => {
      this.inFlight = null;
      throw error;
    });
    return this.inFlight;
  }

  private async buildEntries(): Promise<FinturuDirectoryEntry[]> {
    const [customers, wallets, transfers, stripeCustomers, stripeTransfers] = await Promise.all([
      this.finturuClient.getCustomers(),
      this.finturuClient.getWallets(),
      this.finturuClient.getTransfers(),
      this.finturuClient.getStripeCustomers(),
      this.finturuClient.getStripeTransfers(),
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

      if (!idUser) continue;

      const userWallets = bridgeUserId ? (walletsByUser.get(bridgeUserId) ?? []) : [];
      const walletIds = new Set(userWallets.map((w) => w.idWallet).filter(Boolean));
      const walletAddresses = new Set(
        userWallets.map((w) => String(w.address ?? '').toLowerCase()).filter(Boolean),
      );

      const userTransfers = transfers.filter((t) => {
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
              transfers: stripeCustomerId ? (stripeTransfersByCustomer.get(stripeCustomerId) ?? []) : [],
            }
          : null,
        riskScore: riskFor(customer.status, userTransfers),
      });
    }

    return entries;
  }

  async page(query: FinturuDirectoryQuery): Promise<FinturuDirectoryPage> {
    const entries = await this.entries();

    const search = query.search?.trim().toLowerCase();
    const filtered = search
      ? entries.filter((entry) => buildSearchText(entry).includes(search))
      : entries;

    // Same order as the old Mongo copy: highest risk first, then name.
    const sorted = [...filtered].sort((a, b) => {
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });

    const items = sorted.slice(query.offset, query.offset + query.limit);

    return { items, total: filtered.length, syncedAt: await this.lastSyncedAt() };
  }
}

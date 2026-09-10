import type { FinturuApiClient } from '../modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import type { FinturuWalletHolder, FinturuWalletSource } from '../modules/screening/domain/ports/FinturuWalletSource.js';

/** Narrows a `wallets: readonly unknown[]` element to trimmed+lowercased address. Calls onDropped on bad shape (D4). */
export function extractWalletAddresses(
  wallets: readonly unknown[],
  onDropped?: (index: number, reason: string) => void,
): string[] {
  const result: string[] = [];
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    if (typeof w !== 'object' || w === null) { onDropped?.(i, 'not a plain object'); continue; }
    const address = (w as Record<string, unknown>).address;
    if (typeof address !== 'string' || address.trim().length === 0) {
      onDropped?.(i, 'missing or empty address');
      continue;
    }
    result.push(address.trim().toLowerCase());
  }
  return result;
}

/**
 * Composition bridge: screening ← FinturuApiClient (eslint boundaries).
 *
 * Used to stream through `FinturuDirectoryRepository`'s Mongo copy — that
 * copy is gone (composed on demand now, see `LiveFinturuDirectoryRepository`),
 * and rebuilding the FULL enriched directory (transfers, Stripe correlation)
 * just to read wallet addresses would recompute a lot the rescreen never
 * uses. Sanctions screening only needs "which addresses does this customer
 * hold", so it goes straight to `getCustomers()` + `getWallets()` — both
 * DB-backed on the `api-business` side, same as the directory.
 */
export function createFinturuWalletSource(finturuClient: FinturuApiClient): FinturuWalletSource {
  return {
    async *streamHolders(batchSize: number): AsyncIterable<FinturuWalletHolder> {
      const [customers, wallets] = await Promise.all([
        finturuClient.getCustomers(),
        finturuClient.getWallets(),
      ]);

      const walletsByBridgeId = new Map<string, unknown[]>();
      for (const wallet of wallets) {
        const key = wallet.customerId ?? '';
        if (!key) continue;
        const list = walletsByBridgeId.get(key) ?? [];
        list.push(wallet);
        walletsByBridgeId.set(key, list);
      }

      let batch: FinturuWalletHolder[] = [];
      for (const customer of customers) {
        const bridgeUserId = customer.idUserBridge ? String(customer.idUserBridge).trim() : '';
        const idUser = customer.idUser ? String(customer.idUser).trim() : bridgeUserId;
        if (!idUser || !bridgeUserId) continue;

        const customerWallets = walletsByBridgeId.get(bridgeUserId) ?? [];
        if (customerWallets.length === 0) continue;

        const addresses = extractWalletAddresses(customerWallets, (idx, reason) => {
          console.warn(`[wallet-source] dropped wallet[${idx}] for customer ${idUser}: ${reason}`);
        });
        if (addresses.length === 0) continue;

        batch.push({ customerId: idUser, walletAddresses: addresses });
        if (batch.length >= batchSize) {
          yield* batch;
          batch = [];
        }
      }
      yield* batch;
    },
  };
}

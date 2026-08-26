import type { FinturuDirectoryRepository } from '../modules/case-management/domain/ports/FinturuDirectoryRepository.js';
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

/** Composition bridge: screening ← FinturuDirectoryRepository (eslint boundaries). */
export function createFinturuWalletSource(directory: FinturuDirectoryRepository): FinturuWalletSource {
  return {
    async *streamHolders(batchSize: number): AsyncIterable<FinturuWalletHolder> {
      let offset = 0;
      while (true) {
        const page = await directory.page({ limit: batchSize, offset });
        for (const entry of page.items) {
          const addresses = extractWalletAddresses(entry.wallets, (idx, reason) => {
            console.warn(`[wallet-source] dropped wallet[${idx}] for customer ${entry.idUser}: ${reason}`);
          });
          if (addresses.length === 0) continue;
          yield { customerId: entry.idUser, walletAddresses: addresses };
        }
        if (page.items.length < batchSize) break;
        offset += batchSize;
      }
    },
  };
}

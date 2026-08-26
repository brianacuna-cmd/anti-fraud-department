import type { FinturuDirectoryEntry, FinturuDirectoryRepository } from '../../src/modules/case-management/domain/ports/FinturuDirectoryRepository.js';
import { createFinturuWalletSource, extractWalletAddresses } from '../../src/composition/finturuWalletSource.js';

const entry = (idUser: string, wallets: readonly unknown[]): FinturuDirectoryEntry => ({
  idUser, idUserBridge: null, name: null, lastname: null, email: null, phone: null,
  status: null, address: null, idCustomer: null, wallets, transfers: [], stripe: null, riskScore: 0,
});

function dir(pages: FinturuDirectoryEntry[][]): FinturuDirectoryRepository {
  return {
    async page({ limit, offset }: { limit: number; offset: number }) {
      return { items: pages[Math.floor(offset / limit)] ?? [], total: pages.flat().length, syncedAt: null };
    },
    async replaceAll() {},
    async lastSyncedAt() { return null; },
  };
}

describe('extractWalletAddresses', () => {
  it('returns trimmed+lowercased addresses', () =>
    expect(extractWalletAddresses([{ address: ' 0xABC ' }, { address: '0xDEF' }])).toEqual(['0xabc', '0xdef']));

  it('drops number/null elements and calls onDropped', () => {
    const dropped: string[] = [];
    const result = extractWalletAddresses([42, null, { address: '0xOK' }], (_i: number, r: string) => dropped.push(r));
    expect(result).toEqual(['0xok']);
    expect(dropped).toHaveLength(2);
  });

  it('drops wallets with missing/empty address', () =>
    expect(extractWalletAddresses([{ address: '' }, {}, { address: '  ' }])).toHaveLength(0));
});

describe('createFinturuWalletSource', () => {
  async function collect(d: FinturuDirectoryRepository, batchSize = 10) {
    const out = [];
    for await (const h of createFinturuWalletSource(d).streamHolders(batchSize)) out.push(h);
    return out;
  }

  it('yields holders with valid addresses', async () => {
    const holders = await collect(dir([[entry('u1', [{ address: '0xA' }]), entry('u2', [{ address: '0xB' }])]]));
    expect(holders).toEqual([
      { customerId: 'u1', walletAddresses: ['0xa'] },
      { customerId: 'u2', walletAddresses: ['0xb'] },
    ]);
  });

  it('skips holders with zero valid addresses', async () => {
    const holders = await collect(dir([[entry('u1', [42, null]), entry('u2', [{ address: '0xC' }])]]));
    expect(holders).toHaveLength(1);
    expect(holders[0]!.customerId).toBe('u2');
  });

  it('paginates across pages', async () => {
    const holders = await collect(dir([[entry('u1', [{ address: '0x1' }]), entry('u2', [{ address: '0x2' }])], [entry('u3', [{ address: '0x3' }])]]), 2);
    expect(holders.map((h) => h.customerId)).toEqual(['u1', 'u2', 'u3']);
  });
});

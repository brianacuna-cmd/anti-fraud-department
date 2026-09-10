import type { FinturuApiClient, FinturuCustomerDto, FinturuWalletDto } from '../../src/modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import { createFinturuWalletSource, extractWalletAddresses } from '../../src/composition/finturuWalletSource.js';

const customer = (idUser: string, idUserBridge: string): FinturuCustomerDto => ({ idUser, idUserBridge });

function client(customers: FinturuCustomerDto[], wallets: FinturuWalletDto[]): FinturuApiClient {
  return {
    async getCustomers() { return customers; },
    async getWallets() { return wallets; },
  } as unknown as FinturuApiClient;
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
  async function collect(c: FinturuApiClient, batchSize = 10) {
    const out = [];
    for await (const h of createFinturuWalletSource(c).streamHolders(batchSize)) out.push(h);
    return out;
  }

  it('yields holders with valid addresses, keyed by idUser (not bridge id)', async () => {
    const holders = await collect(
      client(
        [customer('u1', 'b1'), customer('u2', 'b2')],
        [
          { idWallet: 'w1', customerId: 'b1', address: '0xA' },
          { idWallet: 'w2', customerId: 'b2', address: '0xB' },
        ],
      ),
    );
    expect(holders).toEqual([
      { customerId: 'u1', walletAddresses: ['0xa'] },
      { customerId: 'u2', walletAddresses: ['0xb'] },
    ]);
  });

  it('skips customers with zero valid addresses', async () => {
    const holders = await collect(
      client(
        [customer('u1', 'b1'), customer('u2', 'b2')],
        [
          { idWallet: 'w1', customerId: 'b1', address: undefined },
          { idWallet: 'w2', customerId: 'b2', address: '0xC' },
        ],
      ),
    );
    expect(holders).toHaveLength(1);
    expect(holders[0]!.customerId).toBe('u2');
  });

  it('skips customers with no wallets at all', async () => {
    const holders = await collect(
      client([customer('u1', 'b1'), customer('u2', 'b2')], [{ idWallet: 'w2', customerId: 'b2', address: '0xC' }]),
    );
    expect(holders).toHaveLength(1);
    expect(holders[0]!.customerId).toBe('u2');
  });

  it('batches across a batchSize boundary without dropping or duplicating', async () => {
    const holders = await collect(
      client(
        [customer('u1', 'b1'), customer('u2', 'b2'), customer('u3', 'b3')],
        [
          { idWallet: 'w1', customerId: 'b1', address: '0x1' },
          { idWallet: 'w2', customerId: 'b2', address: '0x2' },
          { idWallet: 'w3', customerId: 'b3', address: '0x3' },
        ],
      ),
      2,
    );
    expect(holders.map((h) => h.customerId)).toEqual(['u1', 'u2', 'u3']);
  });

  it('falls back to the bridge id as customerId when idUser is absent', async () => {
    const holders = await collect(
      client([{ idUser: undefined, idUserBridge: 'b1' }], [{ idWallet: 'w1', customerId: 'b1', address: '0xA' }]),
    );
    expect(holders).toEqual([{ customerId: 'b1', walletAddresses: ['0xa'] }]);
  });
});

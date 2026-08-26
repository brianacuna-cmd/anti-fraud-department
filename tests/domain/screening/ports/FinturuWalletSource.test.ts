import type { FinturuWalletHolder, FinturuWalletSource } from '../../../../src/modules/screening/domain/ports/FinturuWalletSource.js';

// In-memory fake that lets tests control the emitted batches.
class FakeFinturuWalletSource implements FinturuWalletSource {
  constructor(private readonly holders: FinturuWalletHolder[]) {}

  async *streamHolders(batchSize: number): AsyncIterable<FinturuWalletHolder> {
    for (let i = 0; i < this.holders.length; i += batchSize) {
      yield* this.holders.slice(i, i + batchSize);
    }
  }
}

describe('FinturuWalletSource (port contract)', () => {
  it('streamHolders yields FinturuWalletHolder items with customerId and walletAddresses fields', async () => {
    const holders: FinturuWalletHolder[] = [
      { customerId: 'cust-001', walletAddresses: ['0xabc', '0xdef'] },
      { customerId: 'cust-002', walletAddresses: ['0x123'] },
    ];
    const source = new FakeFinturuWalletSource(holders);

    const collected: FinturuWalletHolder[] = [];
    for await (const h of source.streamHolders(10)) {
      collected.push(h);
    }

    expect(collected).toHaveLength(2);
    expect(collected[0]).toStrictEqual({ customerId: 'cust-001', walletAddresses: ['0xabc', '0xdef'] });
    expect(collected[1]).toStrictEqual({ customerId: 'cust-002', walletAddresses: ['0x123'] });
  });

  it('streamHolders respects batchSize and emits all holders across multiple batches', async () => {
    const holders: FinturuWalletHolder[] = Array.from({ length: 5 }, (_, i) => ({
      customerId: `cust-${i}`,
      walletAddresses: [`0x${i.toString().padStart(3, '0')}`],
    }));
    const source = new FakeFinturuWalletSource(holders);

    const collected: FinturuWalletHolder[] = [];
    for await (const h of source.streamHolders(2)) {
      collected.push(h);
    }

    expect(collected).toHaveLength(5);
    expect(collected[2]?.customerId).toBe('cust-2');
  });

  it('streamHolders emits nothing for an empty directory', async () => {
    const source = new FakeFinturuWalletSource([]);

    const collected: FinturuWalletHolder[] = [];
    for await (const h of source.streamHolders(10)) {
      collected.push(h);
    }

    expect(collected).toHaveLength(0);
  });
});

import { createIndexWatchlistEntryUseCase } from '../../../../src/modules/screening/application/IndexWatchlistEntry.js';
import type { PhoneticEncoder } from '../../../../src/modules/screening/domain/ports/PhoneticEncoder.js';
import type { NameNormalizer } from '../../../../src/modules/screening/domain/ports/NameNormalizer.js';
import type { Transaction } from '../../../../src/modules/screening/domain/ports/UnitOfWork.js';
import { generateWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { normalizeName } from '../../../../src/modules/screening/domain/ports/NameNormalizer.js';
import { InMemoryWatchlistEntryRepository } from '../../../helpers/screening/InMemoryWatchlistEntryRepository.js';

class FakePhoneticEncoder implements PhoneticEncoder {
  encode(token: string): string[] {
    return [token.slice(0, 3).toUpperCase()];
  }
}

const realNormalizer: NameNormalizer = { normalize: normalizeName };

/** Minimal opaque tx token — replicates what MongoUnitOfWork would pass. */
const FAKE_TX = Symbol('fake-tx') as unknown as Transaction;

describe('IndexWatchlistEntry — tx threading (ADR-3)', () => {
  it('passes tx to findToIndex and updateIndexedFields when tx is provided', async () => {
    const id = generateWatchlistEntryId();
    const base = new InMemoryWatchlistEntryRepository();
    base.seed({ id, name: 'Alice Cooper' });

    const findToIndexCalls: (Transaction | undefined)[] = [];
    const updateIndexedFieldsCalls: (Transaction | undefined)[] = [];

    const wrapping: typeof base = new Proxy(base, {
      get(target, prop) {
        if (prop === 'findToIndex') {
          return async (entryId: Parameters<typeof base.findToIndex>[0], tx?: Transaction) => {
            findToIndexCalls.push(tx);
            return target.findToIndex(entryId, tx);
          };
        }
        if (prop === 'updateIndexedFields') {
          return async (
            entryId: Parameters<typeof base.updateIndexedFields>[0],
            fields: Parameters<typeof base.updateIndexedFields>[1],
            tx?: Transaction,
          ) => {
            updateIndexedFieldsCalls.push(tx);
            return target.updateIndexedFields(entryId, fields, tx);
          };
        }
        return Reflect.get(target, prop, target);
      },
    });

    const indexWatchlistEntry = createIndexWatchlistEntryUseCase({
      watchlistEntryRepository: wrapping,
      nameNormalizer: realNormalizer,
      phoneticEncoder: new FakePhoneticEncoder(),
    });

    await indexWatchlistEntry({ entryId: id, tx: FAKE_TX });

    expect(findToIndexCalls).toHaveLength(1);
    expect(findToIndexCalls[0]).toBe(FAKE_TX);
    expect(updateIndexedFieldsCalls).toHaveLength(1);
    expect(updateIndexedFieldsCalls[0]).toBe(FAKE_TX);
  });

  it('passes undefined tx to findToIndex and updateIndexedFields when no tx is provided (backward-compatible)', async () => {
    const id = generateWatchlistEntryId();
    const base = new InMemoryWatchlistEntryRepository();
    base.seed({ id, name: 'Bob Marley' });

    const findToIndexCalls: (Transaction | undefined)[] = [];

    const wrapping: typeof base = new Proxy(base, {
      get(target, prop) {
        if (prop === 'findToIndex') {
          return async (entryId: Parameters<typeof base.findToIndex>[0], tx?: Transaction) => {
            findToIndexCalls.push(tx);
            return target.findToIndex(entryId, tx);
          };
        }
        return Reflect.get(target, prop, target);
      },
    });

    const indexWatchlistEntry = createIndexWatchlistEntryUseCase({
      watchlistEntryRepository: wrapping,
      nameNormalizer: realNormalizer,
      phoneticEncoder: new FakePhoneticEncoder(),
    });

    await indexWatchlistEntry({ entryId: id });

    expect(findToIndexCalls[0]).toBeUndefined();
  });
});

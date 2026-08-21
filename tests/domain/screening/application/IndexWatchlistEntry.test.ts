import { createIndexWatchlistEntryUseCase } from '../../../../src/modules/screening/application/IndexWatchlistEntry.js';
import type { PhoneticEncoder } from '../../../../src/modules/screening/domain/ports/PhoneticEncoder.js';
import type { NameNormalizer } from '../../../../src/modules/screening/domain/ports/NameNormalizer.js';
import type {
  WatchlistEntryIndexedFields,
  WatchlistEntryRepository,
  WatchlistEntryToIndex,
} from '../../../../src/modules/screening/domain/ports/WatchlistEntryRepository.js';
import { generateWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { normalizeName } from '../../../../src/modules/screening/domain/ports/NameNormalizer.js';

class FakePhoneticEncoder implements PhoneticEncoder {
  readonly calls: string[] = [];

  encode(token: string): string[] {
    this.calls.push(token);
    return [token.slice(0, 3).toUpperCase()];
  }
}

const realNormalizer: NameNormalizer = { normalize: normalizeName };

class InMemoryWatchlistEntryRepository implements WatchlistEntryRepository {
  private readonly entries = new Map<string, WatchlistEntryToIndex>();
  readonly updates = new Map<string, WatchlistEntryIndexedFields>();

  seed(entry: WatchlistEntryToIndex): void {
    this.entries.set(entry.id, entry);
  }

  async findToIndex(id: string): Promise<WatchlistEntryToIndex | null> {
    return this.entries.get(id) ?? null;
  }

  async updateIndexedFields(id: string, fields: WatchlistEntryIndexedFields): Promise<void> {
    this.updates.set(id, fields);
  }
}

describe('IndexWatchlistEntry (application use case)', () => {
  it('computes nombre_normalizado via the shared NameNormalizer and persists it', async () => {
    const id = generateWatchlistEntryId();
    const repository = new InMemoryWatchlistEntryRepository();
    repository.seed({ id, nombre: 'JOHN  Smith-O\'Brien' });
    const phoneticEncoder = new FakePhoneticEncoder();

    const indexWatchlistEntry = createIndexWatchlistEntryUseCase({
      watchlistEntryRepository: repository,
      nameNormalizer: realNormalizer,
      phoneticEncoder,
    });

    await indexWatchlistEntry({ entryId: id });

    const persisted = repository.updates.get(id);
    expect(persisted?.nombreNormalizado).toBe(normalizeName('JOHN  Smith-O\'Brien'));
  });

  it('computes phonetic_keys per token via the injected PhoneticEncoder, deduped', async () => {
    const id = generateWatchlistEntryId();
    const repository = new InMemoryWatchlistEntryRepository();
    repository.seed({ id, nombre: 'John Johnson' });
    const phoneticEncoder = new FakePhoneticEncoder();

    const indexWatchlistEntry = createIndexWatchlistEntryUseCase({
      watchlistEntryRepository: repository,
      nameNormalizer: realNormalizer,
      phoneticEncoder,
    });

    await indexWatchlistEntry({ entryId: id });

    expect(phoneticEncoder.calls).toEqual(['john', 'johnson']);
    const persisted = repository.updates.get(id);
    expect(persisted?.phoneticKeys).toEqual(['JOH']);
  });

  it('is a no-op when the entry does not exist', async () => {
    const repository = new InMemoryWatchlistEntryRepository();
    const phoneticEncoder = new FakePhoneticEncoder();

    const indexWatchlistEntry = createIndexWatchlistEntryUseCase({
      watchlistEntryRepository: repository,
      nameNormalizer: realNormalizer,
      phoneticEncoder,
    });

    await indexWatchlistEntry({ entryId: generateWatchlistEntryId() });

    expect(repository.updates.size).toBe(0);
  });
});

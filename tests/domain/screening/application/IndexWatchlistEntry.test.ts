import { createIndexWatchlistEntryUseCase } from '../../../../src/modules/screening/application/IndexWatchlistEntry.js';
import type { PhoneticEncoder } from '../../../../src/modules/screening/domain/ports/PhoneticEncoder.js';
import type { NameNormalizer } from '../../../../src/modules/screening/domain/ports/NameNormalizer.js';
import { generateWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { normalizeName } from '../../../../src/modules/screening/domain/ports/NameNormalizer.js';
import { InMemoryWatchlistEntryRepository } from '../../../helpers/screening/InMemoryWatchlistEntryRepository.js';

class FakePhoneticEncoder implements PhoneticEncoder {
  readonly calls: string[] = [];

  encode(token: string): string[] {
    this.calls.push(token);
    return [token.slice(0, 3).toUpperCase()];
  }
}

const realNormalizer: NameNormalizer = { normalize: normalizeName };

describe('IndexWatchlistEntry (application use case)', () => {
  it('computes normalized_name via the shared NameNormalizer and persists it', async () => {
    const id = generateWatchlistEntryId();
    const repository = new InMemoryWatchlistEntryRepository();
    repository.seed({ id, name: 'JOHN  Smith-O\'Brien' });
    const phoneticEncoder = new FakePhoneticEncoder();

    const indexWatchlistEntry = createIndexWatchlistEntryUseCase({
      watchlistEntryRepository: repository,
      nameNormalizer: realNormalizer,
      phoneticEncoder,
    });

    await indexWatchlistEntry({ entryId: id });

    const persisted = repository.updates.get(id);
    expect(persisted?.normalizedName).toBe(normalizeName('JOHN  Smith-O\'Brien'));
  });

  it('computes phonetic_keys per token via the injected PhoneticEncoder, deduped', async () => {
    const id = generateWatchlistEntryId();
    const repository = new InMemoryWatchlistEntryRepository();
    repository.seed({ id, name: 'John Johnson' });
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

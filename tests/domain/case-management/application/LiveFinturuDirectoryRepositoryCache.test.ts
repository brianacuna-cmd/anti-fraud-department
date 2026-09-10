import { LiveFinturuDirectoryRepository } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/finturu/LiveFinturuDirectoryRepository.js';
import type { FinturuApiClient } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';

/**
 * Every `page()` call used to rebuild the whole customer×wallet×transfer×
 * Stripe correlation from scratch — a paginator click or a search keystroke
 * fired one of these each time, and it showed up as the panel appearing
 * stuck on the previous page while the rebuild ran. These tests pin the
 * fix: a short in-memory cache so a burst of page/search calls reuses one
 * build.
 */
function countingClient() {
  let calls = 0;
  const client = {
    async getCustomers() {
      calls++;
      return [{ idUser: 'u-1', idUserBridge: 'b-1', email: 'a@b.com' }];
    },
    async getWallets() {
      return [];
    },
    async getTransfers() {
      return [];
    },
    async getStripeCustomers() {
      return [];
    },
    async getStripeTransfers() {
      return [];
    },
  } as unknown as FinturuApiClient;
  return { client, calls: () => calls };
}

describe('LiveFinturuDirectoryRepository — caching', () => {
  it('reuses one build across a burst of page() calls', async () => {
    const { client, calls } = countingClient();
    const directory = new LiveFinturuDirectoryRepository(client);

    await directory.page({ limit: 10, offset: 0 });
    await directory.page({ limit: 10, offset: 0, search: 'a' });
    await directory.page({ limit: 10, offset: 10 });

    expect(calls()).toBe(1);
  });

  it('shares one in-flight build across concurrent page() calls', async () => {
    const { client, calls } = countingClient();
    const directory = new LiveFinturuDirectoryRepository(client);

    await Promise.all([
      directory.page({ limit: 10, offset: 0 }),
      directory.page({ limit: 10, offset: 0 }),
      directory.page({ limit: 10, offset: 0 }),
    ]);

    expect(calls()).toBe(1);
  });

  it('rebuilds once the cache goes stale', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    try {
      const { client, calls } = countingClient();
      const directory = new LiveFinturuDirectoryRepository(client);

      await directory.page({ limit: 10, offset: 0 });
      jest.advanceTimersByTime(9_000);
      await directory.page({ limit: 10, offset: 0 });

      expect(calls()).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports syncedAt as the last build time, not the request time', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    try {
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const { client } = countingClient();
      const directory = new LiveFinturuDirectoryRepository(client);

      const first = await directory.page({ limit: 10, offset: 0 });
      jest.setSystemTime(new Date('2026-01-01T00:00:05.000Z'));
      const second = await directory.page({ limit: 10, offset: 0 });

      expect(first.syncedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(second.syncedAt).toBe(first.syncedAt);
    } finally {
      jest.useRealTimers();
    }
  });
});

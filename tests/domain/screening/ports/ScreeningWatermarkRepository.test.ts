import type { ScreeningWatermarkRepository } from '../../../../src/modules/screening/domain/ports/ScreeningWatermarkRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const T1 = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const T2 = fromDate(new Date('2026-01-02T12:00:00.000Z'));

class InMemoryScreeningWatermarkRepository implements ScreeningWatermarkRepository {
  private readonly store = new Map<string, string>();

  private key(organizationId: string, jobName: string): string {
    return `${organizationId}::${jobName}`;
  }

  async read(organizationId: string, jobName: string) {
    const v = this.store.get(this.key(organizationId, jobName));
    return v !== undefined ? (v as ReturnType<typeof fromDate>) : null;
  }

  async advance(organizationId: string, jobName: string, watermark: ReturnType<typeof fromDate>): Promise<void> {
    this.store.set(this.key(organizationId, jobName), watermark);
  }
}

describe('ScreeningWatermarkRepository (port contract)', () => {
  it('read returns null before any watermark has been advanced', async () => {
    const repo: ScreeningWatermarkRepository = new InMemoryScreeningWatermarkRepository();

    const result = await repo.read('org-1', 'wallet-rescreen');

    expect(result).toBeNull();
  });

  it('advance persists and read returns the stored watermark', async () => {
    const repo: ScreeningWatermarkRepository = new InMemoryScreeningWatermarkRepository();

    await repo.advance('org-1', 'wallet-rescreen', T1);
    const result = await repo.read('org-1', 'wallet-rescreen');

    expect(result).toBe(T1);
  });

  it('advance is idempotent — calling it again with a newer value overwrites the old one', async () => {
    const repo: ScreeningWatermarkRepository = new InMemoryScreeningWatermarkRepository();

    await repo.advance('org-1', 'wallet-rescreen', T1);
    await repo.advance('org-1', 'wallet-rescreen', T2);
    const result = await repo.read('org-1', 'wallet-rescreen');

    expect(result).toBe(T2);
  });

  it('watermarks are scoped per (organizationId, jobName) pair', async () => {
    const repo: ScreeningWatermarkRepository = new InMemoryScreeningWatermarkRepository();

    await repo.advance('org-1', 'wallet-rescreen', T1);
    await repo.advance('org-2', 'wallet-rescreen', T2);

    const org1 = await repo.read('org-1', 'wallet-rescreen');
    const org2 = await repo.read('org-2', 'wallet-rescreen');
    const other = await repo.read('org-1', 'other-job');

    expect(org1).toBe(T1);
    expect(org2).toBe(T2);
    expect(other).toBeNull();
  });
});

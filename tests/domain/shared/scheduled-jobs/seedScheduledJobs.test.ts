import { seedScheduledJobs } from '../../../../src/shared/scheduled-jobs/seedScheduledJobs.js';
import type {
  RecordScheduledJobRunInput,
  ScheduledJobRepository,
  SeedScheduledJobInput,
} from '../../../../src/shared/scheduled-jobs/ScheduledJobRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-08-28T15:00:00.000Z'));

const FIVE_NAMES = [
  'sla_sweep',
  'outbox_publish',
  'customer_outgoing_webhook_dispatch',
  'directory_sync',
  'wallet_sanctions_rescreen',
] as const;

class FakeCatalog implements ScheduledJobRepository {
  readonly seeds: SeedScheduledJobInput[] = [];

  async seed(input: SeedScheduledJobInput): Promise<void> {
    this.seeds.push(input);
  }

  async findByName(_name: string): Promise<null> {
    return null;
  }

  async recordRun(_input: RecordScheduledJobRunInput): Promise<void> {
    /* unused */
  }
}

function byName(catalog: FakeCatalog, name: string): SeedScheduledJobInput {
  const row = catalog.seeds.find((seed) => seed.name === name);
  if (row === undefined) {
    throw new Error(`missing seed for ${name}`);
  }
  return row;
}

describe('seedScheduledJobs', () => {
  it('seeds one document per platform job name with null organization_id', async () => {
    const catalog = new FakeCatalog();

    await seedScheduledJobs(catalog, {
      now: NOW,
      slaSweepIntervalMs: 60_000,
      outboxPublishIntervalMs: 60_000,
      outgoingWebhookDispatchIntervalMs: 5_000,
      directorySyncIntervalMinutes: 360,
      walletRescreenEnabled: true,
    });

    expect(catalog.seeds.map((seed) => seed.name)).toEqual([...FIVE_NAMES]);
    expect(catalog.seeds).toHaveLength(5);
    for (const seed of catalog.seeds) {
      expect(seed.organizationId).toBeNull();
      expect(seed.now).toBe(NOW);
    }
  });

  it('enables pollers and labels cadence from the known interval (not a cron parse)', async () => {
    const catalog = new FakeCatalog();

    await seedScheduledJobs(catalog, {
      now: NOW,
      slaSweepIntervalMs: 60_000,
      outboxPublishIntervalMs: 90_000,
      outgoingWebhookDispatchIntervalMs: 5_000,
      directorySyncIntervalMinutes: 15,
      walletRescreenEnabled: true,
    });

    expect(byName(catalog, 'sla_sweep')).toMatchObject({
      enabled: true,
      cronExpression: 'every 60s',
    });
    expect(byName(catalog, 'outbox_publish')).toMatchObject({
      enabled: true,
      cronExpression: 'every 90s',
    });
    expect(byName(catalog, 'customer_outgoing_webhook_dispatch')).toMatchObject({
      enabled: true,
      cronExpression: 'every 5s',
    });
    expect(byName(catalog, 'directory_sync')).toMatchObject({
      enabled: true,
      cronExpression: 'every 15m',
    });
    expect(byName(catalog, 'wallet_sanctions_rescreen')).toMatchObject({
      enabled: true,
      cronExpression: 'daily 00:00 America/Bogota',
    });
  });

  it('still seeds directory_sync and wallet_sanctions_rescreen when those loops are disabled', async () => {
    const catalog = new FakeCatalog();

    await seedScheduledJobs(catalog, {
      now: NOW,
      slaSweepIntervalMs: 60_000,
      outboxPublishIntervalMs: 60_000,
      outgoingWebhookDispatchIntervalMs: 5_000,
      directorySyncIntervalMinutes: 0,
      walletRescreenEnabled: false,
    });

    expect(catalog.seeds.map((seed) => seed.name)).toEqual([...FIVE_NAMES]);
    expect(byName(catalog, 'directory_sync')).toMatchObject({
      enabled: false,
      organizationId: null,
    });
    expect(byName(catalog, 'wallet_sanctions_rescreen')).toMatchObject({
      enabled: false,
      cronExpression: 'daily 00:00 America/Bogota',
      organizationId: null,
    });
    expect(byName(catalog, 'sla_sweep').enabled).toBe(true);
    expect(byName(catalog, 'outbox_publish').enabled).toBe(true);
    expect(byName(catalog, 'customer_outgoing_webhook_dispatch').enabled).toBe(true);
  });

  it('treats a negative directory interval as disabled and still seeds the row', async () => {
    const catalog = new FakeCatalog();

    await seedScheduledJobs(catalog, {
      now: NOW,
      slaSweepIntervalMs: 60_000,
      outboxPublishIntervalMs: 60_000,
      outgoingWebhookDispatchIntervalMs: 5_000,
      directorySyncIntervalMinutes: -1,
      walletRescreenEnabled: false,
    });

    expect(byName(catalog, 'directory_sync').enabled).toBe(false);
    expect(byName(catalog, 'directory_sync').name).toBe('directory_sync');
  });
});

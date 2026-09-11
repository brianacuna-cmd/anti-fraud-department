import { seedScheduledJobs } from '../../../../src/shared/scheduled-jobs/seedScheduledJobs.js';
import type {
  RecordScheduledJobRunInput,
  ScheduledJobRepository,
  SeedScheduledJobInput,
} from '../../../../src/shared/scheduled-jobs/ScheduledJobRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-08-28T15:00:00.000Z'));

/** El catalogo completo, en el orden en que se siembra. */
const PLATFORM_JOB_NAMES = [
  'sla_sweep',
  'outbox_publish',
  'customer_outgoing_webhook_dispatch',
  'wallet_sanctions_rescreen',
  'daily_fraud_metrics',
  'audit_trail_archive',
  'sanction_list_sync',
  'customer_sanctions_rescreen',
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
      walletRescreenEnabled: true,
      auditArchiveEnabled: true,
      sanctionListSyncEnabled: true,
      customerRescreenEnabled: true,
    });

    expect(catalog.seeds.map((seed) => seed.name)).toEqual([...PLATFORM_JOB_NAMES]);
    expect(catalog.seeds).toHaveLength(PLATFORM_JOB_NAMES.length);
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
      walletRescreenEnabled: true,
      auditArchiveEnabled: true,
      sanctionListSyncEnabled: true,
      customerRescreenEnabled: true,
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
    expect(byName(catalog, 'wallet_sanctions_rescreen')).toMatchObject({
      enabled: true,
      cronExpression: 'daily 00:00 America/Bogota',
    });
    expect(byName(catalog, 'daily_fraud_metrics')).toMatchObject({
      enabled: true,
      cronExpression: 'daily 00:00 America/Bogota',
      organizationId: null,
    });
  });

  it('still seeds wallet_sanctions_rescreen when that loop is disabled', async () => {
    const catalog = new FakeCatalog();

    await seedScheduledJobs(catalog, {
      now: NOW,
      slaSweepIntervalMs: 60_000,
      outboxPublishIntervalMs: 60_000,
      outgoingWebhookDispatchIntervalMs: 5_000,
      walletRescreenEnabled: false,
      auditArchiveEnabled: false,
      sanctionListSyncEnabled: false,
      customerRescreenEnabled: false,
    });

    expect(catalog.seeds.map((seed) => seed.name)).toEqual([...PLATFORM_JOB_NAMES]);
    expect(byName(catalog, 'wallet_sanctions_rescreen')).toMatchObject({
      enabled: false,
      cronExpression: 'daily 00:00 America/Bogota',
      organizationId: null,
    });
    expect(byName(catalog, 'sla_sweep').enabled).toBe(true);
    expect(byName(catalog, 'outbox_publish').enabled).toBe(true);
    expect(byName(catalog, 'customer_outgoing_webhook_dispatch').enabled).toBe(true);
  });
});

describe('seedScheduledJobs · archivado de auditoría (AUD-004)', () => {
  it('siembra audit_trail_archive DESACTIVADO cuando no hay bucket', async () => {
    const catalog = new FakeCatalog();

    await seedScheduledJobs(catalog, {
      now: NOW,
      slaSweepIntervalMs: 60_000,
      outboxPublishIntervalMs: 60_000,
      outgoingWebhookDispatchIntervalMs: 5_000,
      walletRescreenEnabled: true,
      auditArchiveEnabled: false,
      sanctionListSyncEnabled: false,
      customerRescreenEnabled: false,
    });

    /*
     * La fila EXISTE aunque esté apagada.
     *
     * Un hueco silencioso en la lista de tareas programadas es lo que hace que
     * nadie repare en que la auditoría no se está archivando: se ve una lista
     * completa y se concluye que todo lo previsto corre.
     */
    expect(byName(catalog, 'audit_trail_archive')).toMatchObject({ enabled: false });
  });

  it('lo activa cuando hay bucket, con cadencia mensual', async () => {
    const catalog = new FakeCatalog();

    await seedScheduledJobs(catalog, {
      now: NOW,
      slaSweepIntervalMs: 60_000,
      outboxPublishIntervalMs: 60_000,
      outgoingWebhookDispatchIntervalMs: 5_000,
      walletRescreenEnabled: true,
      auditArchiveEnabled: true,
      sanctionListSyncEnabled: true,
      customerRescreenEnabled: true,
    });

    expect(byName(catalog, 'audit_trail_archive')).toMatchObject({
      enabled: true,
      cronExpression: 'monthly 02:00 America/Bogota',
    });
  });
});

import type { Instant } from '../time/Instant.js';
import type { ScheduledJobRepository } from './ScheduledJobRepository.js';

export interface SeedScheduledJobsConfig {
  readonly now: Instant;
  readonly slaSweepIntervalMs: number;
  readonly outboxPublishIntervalMs: number;
  readonly outgoingWebhookDispatchIntervalMs: number;
  readonly walletRescreenEnabled: boolean;
  /** AUD-004: falso cuando no hay bucket configurado; el job se siembra desactivado. */
  readonly auditArchiveEnabled: boolean;
  /** AML-001: false while SANCTION_LIST_SYNC_ENABLED is unset; seeded disabled, like the wallet loop. */
  readonly sanctionListSyncEnabled: boolean;
  /** AML-009: false while CUSTOMER_RESCREEN_ENABLED is unset. */
  readonly customerRescreenEnabled: boolean;
}

const WALLET_CADENCE = 'daily 00:00 America/Bogota';

function everySecondsLabel(intervalMs: number): string {
  return `every ${intervalMs / 1000}s`;
}

/**
 * Upserts the platform-wide catalog rows (`organization_id: null`).
 * A disabled wallet loop is still seeded; `enabled` is a label, not a gate.
 *
 * `directory_sync` used to be seeded here too. The directory it refreshed
 * is now composed on demand (`LiveFinturuDirectoryRepository`) instead of
 * materialized into Mongo, so there is nothing left to schedule.
 */
export async function seedScheduledJobs(
  repository: ScheduledJobRepository,
  config: SeedScheduledJobsConfig,
): Promise<void> {
  const platform = { organizationId: null, now: config.now } as const;

  await repository.seed({
    name: 'sla_sweep',
    description: 'Sweep SLA tracking rows',
    cronExpression: everySecondsLabel(config.slaSweepIntervalMs),
    enabled: true,
    ...platform,
  });
  await repository.seed({
    name: 'outbox_publish',
    description: 'Publish pending outbox events',
    cronExpression: everySecondsLabel(config.outboxPublishIntervalMs),
    enabled: true,
    ...platform,
  });
  await repository.seed({
    name: 'customer_outgoing_webhook_dispatch',
    description: 'Dispatch customer outgoing webhook events',
    cronExpression: everySecondsLabel(config.outgoingWebhookDispatchIntervalMs),
    enabled: true,
    ...platform,
  });
  await repository.seed({
    name: 'wallet_sanctions_rescreen',
    description: 'Rescreen wallet addresses against sanctions lists',
    cronExpression: WALLET_CADENCE,
    enabled: config.walletRescreenEnabled,
    ...platform,
  });
  await repository.seed({
    name: 'daily_fraud_metrics',
    description: 'Aggregate nightly per-organization fraud department metrics',
    cronExpression: WALLET_CADENCE,
    enabled: true,
    ...platform,
  });
  /*
   * AUD-004. Se siembra SIEMPRE, aunque no haya bucket, pero desactivado.
   *
   * Asi la fila existe en el catalogo y un administrador ve que el archivado
   * esta previsto y apagado, en vez de no ver nada y concluir que la funcion
   * no existe. Un hueco silencioso en una lista de tareas programadas es lo
   * que hace que nadie repare en que la auditoria no se esta archivando.
   */
  await repository.seed({
    name: 'audit_trail_archive',
    description: 'Copy audit logs older than the hot window to immutable cold storage',
    cronExpression: 'monthly 02:00 America/Bogota',
    enabled: config.auditArchiveEnabled,
    ...platform,
  });
  await repository.seed({
    name: 'sanction_list_sync',
    description: 'Sync the official sanctions lists (OFAC SDN, EU, UK) into every active organization',
    cronExpression: 'daily 23:00 America/Bogota',
    enabled: config.sanctionListSyncEnabled,
    ...platform,
  });
  await repository.seed({
    name: 'customer_sanctions_rescreen',
    description: 'Rescreen customer names against sanctions and internal watchlists',
    cronExpression: 'daily 01:00 America/Bogota',
    enabled: config.customerRescreenEnabled,
    ...platform,
  });
}

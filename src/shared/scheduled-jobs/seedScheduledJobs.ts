import type { Instant } from '../time/Instant.js';
import type { ScheduledJobRepository } from './ScheduledJobRepository.js';

export interface SeedScheduledJobsConfig {
  readonly now: Instant;
  readonly slaSweepIntervalMs: number;
  readonly outboxPublishIntervalMs: number;
  readonly outgoingWebhookDispatchIntervalMs: number;
  readonly directorySyncIntervalMinutes: number;
  readonly walletRescreenEnabled: boolean;
}

const WALLET_CADENCE = 'daily 00:00 America/Bogota';

function everySecondsLabel(intervalMs: number): string {
  return `every ${intervalMs / 1000}s`;
}

function everyMinutesLabel(intervalMinutes: number): string {
  return `every ${intervalMinutes}m`;
}

/**
 * Upserts the five platform-wide catalog rows (`organization_id: null`).
 * Disabled directory/wallet loops are still seeded; `enabled` is a label, not a gate.
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
    name: 'directory_sync',
    description: 'Sync Finturu customer directory',
    cronExpression: everyMinutesLabel(config.directorySyncIntervalMinutes),
    enabled: config.directorySyncIntervalMinutes > 0,
    ...platform,
  });
  await repository.seed({
    name: 'wallet_sanctions_rescreen',
    description: 'Rescreen wallet addresses against sanctions lists',
    cronExpression: WALLET_CADENCE,
    enabled: config.walletRescreenEnabled,
    ...platform,
  });
}

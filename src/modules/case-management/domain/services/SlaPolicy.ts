import type { Instant } from '../../../../shared/time/Instant.js';
import { fromDate, toDate } from '../../../../shared/time/Instant.js';
import type { CasePriority } from '../model/value-objects/CasePriority.js';
import type { OrganizationFraudConfig } from '../model/aggregates/OrganizationFraudConfig.js';

/** Minutes allowed to resolve a case, keyed by the priority it was opened at. */
export type SlaWindowMinutes = Readonly<Record<CasePriority, number>>;

/**
 * Used when a tenant has no `OrganizationFraudConfig` row yet.
 *
 * A missing config must never block intake: refusing to open a fraud case
 * because nobody filled in a settings form is a far worse failure than
 * opening it against a house default. These mirror the values the team
 * already treats as canonical in the config fixtures.
 */
export const DEFAULT_SLA_WINDOW_MINUTES: SlaWindowMinutes = {
  LOW: 240,
  MEDIUM: 120,
  HIGH: 60,
  CRITICAL: 30,
};

/** Projects a tenant's config onto the priority-keyed shape, or falls back wholesale. */
export function slaWindowFromConfig(config: OrganizationFraudConfig | null): SlaWindowMinutes {
  if (!config) return DEFAULT_SLA_WINDOW_MINUTES;
  return {
    LOW: config.slaLowMinutes,
    MEDIUM: config.slaMediumMinutes,
    HIGH: config.slaHighMinutes,
    CRITICAL: config.slaCriticalMinutes,
  };
}

/**
 * `now + window(priority)`, the single place a case's deadline is derived.
 *
 * Computed in epoch milliseconds rather than by mutating a `Date`, so a
 * window that crosses a DST boundary still yields exactly the configured
 * number of minutes — a deadline that silently moves an hour is an SLA
 * breach nobody can explain afterwards.
 */
export function resolveSlaDueDate(
  window: SlaWindowMinutes,
  priority: CasePriority,
  now: Instant,
): Instant {
  const minutes = window[priority];
  return fromDate(new Date(toDate(now).getTime() + minutes * 60_000));
}

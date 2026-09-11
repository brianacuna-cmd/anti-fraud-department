/**
 * Official sanctions lists the platform keeps synchronized (AML-001).
 *
 * The UN consolidated list is deliberately absent. Its designations are
 * transposed into both the EU and the UK lists, so they reach every tenant
 * through those two feeds; a dedicated UN adapter can be added as another
 * value here once its entity schema is verified against a real download.
 */
export type SanctionSource = 'OFAC_SDN' | 'EU_FSF' | 'UK_FCDO';

export const SANCTION_SOURCES: readonly SanctionSource[] = ['OFAC_SDN', 'EU_FSF', 'UK_FCDO'];

const VALID_SANCTION_SOURCES: ReadonlySet<string> = new Set<SanctionSource>(SANCTION_SOURCES);

export function isSanctionSource(value: unknown): value is SanctionSource {
  return typeof value === 'string' && VALID_SANCTION_SOURCES.has(value);
}

/**
 * Name each list is materialized under inside every organization.
 *
 * Distinctive on purpose: the watchlist name is unique per organization, and
 * a tenant may already own a hand-maintained list called just "OFAC". The
 * sync only ever adopts a watchlist whose `source` matches, so a clash is
 * reported instead of silently overwriting the tenant's own entries.
 */
export const SANCTION_WATCHLIST_NAMES: Readonly<Record<SanctionSource, string>> = {
  OFAC_SDN: 'OFAC SDN (official feed)',
  EU_FSF: 'EU Financial Sanctions (official feed)',
  UK_FCDO: 'UK Sanctions List (official feed)',
};

/**
 * UTC range `[dayStartUtc, dayEndUtc)` for a given `America/Bogota` calendar
 * day (`YYYY-MM-DD`). Colombia has no DST, fixed `-05:00` offset — same
 * pattern as `msUntilNextMidnightBogota` (`WalletSanctionsRescreenScheduler`).
 * MUST be used for every Bogota-day bucketing query instead of `$dateToString`
 * with `timezone: 'UTC'` (design #645, LOCKED #642).
 */
export interface BogotaDayUtcRange {
  readonly dayStartUtc: Date;
  readonly dayEndUtc: Date;
}

export function bogotaDayUtcRange(fecha: string): BogotaDayUtcRange {
  const dayStartUtc = new Date(`${fecha}T00:00:00-05:00`);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);
  return { dayStartUtc, dayEndUtc };
}

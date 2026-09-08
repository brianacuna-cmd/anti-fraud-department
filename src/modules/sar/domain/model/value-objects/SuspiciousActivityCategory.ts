import { invariantViolation } from '../../errors/SarError.js';

/**
 * Suspicious activity categories carried on the report.
 *
 * A closed set for the same reason as `TinType`: the filing schema
 * enumerates them, so an unrecognised category has to fail when someone
 * types it, not when the report is already approved and being filed.
 *
 * These are the categories this department actually raises — structuring,
 * fraud, identity, terrorist financing, sanctions evasion and virtual
 * currency. Adding one is a deliberate act: it means the narrative and the
 * evidence behind it can defend that classification before a regulator.
 */
export const SUSPICIOUS_ACTIVITY_CATEGORIES = [
  'STRUCTURING',
  'FRAUD',
  'IDENTIFICATION_DOCUMENTATION',
  'MONEY_LAUNDERING',
  'TERRORIST_FINANCING',
  'SANCTIONS_EVASION',
  'VIRTUAL_CURRENCY',
  'INSIDER_ABUSE',
  'OTHER',
] as const;

export type SuspiciousActivityCategory = (typeof SUSPICIOUS_ACTIVITY_CATEGORIES)[number];

const VALID: ReadonlySet<string> = new Set<string>(SUSPICIOUS_ACTIVITY_CATEGORIES);

export function createSuspiciousActivityCategory(value: string): SuspiciousActivityCategory {
  if (!VALID.has(value)) {
    throw invariantViolation('unknown suspicious activity category', {
      value,
      allowed: [...SUSPICIOUS_ACTIVITY_CATEGORIES],
    });
  }
  return value as SuspiciousActivityCategory;
}

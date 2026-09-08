import { invariantViolation } from '../../errors/SarError.js';

/**
 * Taxpayer identification number type, as FinCEN classifies it.
 *
 * A closed set because it is an enumeration in the filing schema, not free
 * text: a value outside it is rejected at the door rather than at filing
 * time, when the report has already been approved and locked.
 */
export type TinType = 'EIN' | 'SSN_ITIN' | 'FOREIGN' | 'UNKNOWN';

const VALID_TIN_TYPES: ReadonlySet<string> = new Set<TinType>([
  'EIN',
  'SSN_ITIN',
  'FOREIGN',
  'UNKNOWN',
]);

export function createTinType(value: string): TinType {
  if (!VALID_TIN_TYPES.has(value)) {
    throw invariantViolation('TinType must be one of EIN, SSN_ITIN, FOREIGN, UNKNOWN', { value });
  }
  return value as TinType;
}

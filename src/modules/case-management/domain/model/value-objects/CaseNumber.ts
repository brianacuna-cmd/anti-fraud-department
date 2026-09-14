import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

/**
 * Human-readable case reference, e.g. `FD-2026-000042`: what an analyst reads
 * out on a call or writes in an email, instead of the 24-char ObjectId.
 *
 * Unique per organization. The sequence restarts every calendar year (UTC)
 * and is increasing but NOT gapless: a number allocated by a transaction that
 * later aborts is not reused.
 */
export type CaseNumber = Brand<string, 'CaseNumber'>;

const PREFIX = 'FD';
const SEQUENCE_DIGITS = 6;
const PATTERN = /^FD-\d{4}-\d{6,}$/;

export function formatCaseNumber(year: number, sequence: number): CaseNumber {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw invariantViolation('CaseNumber year must be a four-digit integer', { year });
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw invariantViolation('CaseNumber sequence must be a positive integer', { sequence });
  }
  return brand<string, 'CaseNumber'>(`${PREFIX}-${year}-${String(sequence).padStart(SEQUENCE_DIGITS, '0')}`);
}

/** Validates a raw value coming from persistence or route params. */
export function createCaseNumber(value: string): CaseNumber {
  if (!PATTERN.test(value)) {
    throw invariantViolation('CaseNumber must look like FD-YYYY-NNNNNN', { value });
  }
  return brand<string, 'CaseNumber'>(value);
}

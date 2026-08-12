import { randomBytes } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/AuditError.js';

export type AuditLogId = Brand<string, 'AuditLogId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createAuditLogId(value: string): AuditLogId {
  if (value.trim().length === 0) {
    throw invariantViolation('AuditLogId must be a non-empty string', { value });
  }
  return brand<string, 'AuditLogId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateAuditLogId(): AuditLogId {
  return brand<string, 'AuditLogId'>(randomBytes(12).toString('hex'));
}

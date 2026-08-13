import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/AuditError.js';

export type AuditLogId = Brand<string, 'AuditLogId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createAuditLogId(value: string): AuditLogId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('AuditLogId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'AuditLogId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateAuditLogId(): AuditLogId {
  return brand<string, 'AuditLogId'>(generateObjectIdHex());
}

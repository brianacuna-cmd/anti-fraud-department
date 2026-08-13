import { randomBytes } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type OrganizationFraudConfigId = Brand<string, 'OrganizationFraudConfigId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createOrganizationFraudConfigId(value: string): OrganizationFraudConfigId {
  if (value.trim().length === 0) {
    throw invariantViolation('OrganizationFraudConfigId must be a non-empty string', { value });
  }
  return brand<string, 'OrganizationFraudConfigId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateOrganizationFraudConfigId(): OrganizationFraudConfigId {
  return brand<string, 'OrganizationFraudConfigId'>(randomBytes(12).toString('hex'));
}

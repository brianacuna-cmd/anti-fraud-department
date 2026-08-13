import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type OrganizationFraudConfigId = Brand<string, 'OrganizationFraudConfigId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createOrganizationFraudConfigId(value: string): OrganizationFraudConfigId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('OrganizationFraudConfigId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'OrganizationFraudConfigId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateOrganizationFraudConfigId(): OrganizationFraudConfigId {
  return brand<string, 'OrganizationFraudConfigId'>(generateObjectIdHex());
}

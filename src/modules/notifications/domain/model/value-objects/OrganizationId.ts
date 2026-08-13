import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/NotificationsError.js';

export type OrganizationId = Brand<string, 'OrganizationId'>;

/** Validates a raw id coming from `AuthContext` (module-owned copy — see design D3/D15). */
export function createOrganizationId(value: string): OrganizationId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('OrganizationId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'OrganizationId'>(value);
}

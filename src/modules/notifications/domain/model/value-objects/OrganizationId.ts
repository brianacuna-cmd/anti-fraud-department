import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/NotificationsError.js';

export type OrganizationId = Brand<string, 'OrganizationId'>;

/** Validates a raw id coming from `AuthContext` (module-owned copy — see design D3/D15). */
export function createOrganizationId(value: string): OrganizationId {
  if (value.trim().length === 0) {
    throw invariantViolation('OrganizationId must be a non-empty string', { value });
  }
  return brand<string, 'OrganizationId'>(value);
}

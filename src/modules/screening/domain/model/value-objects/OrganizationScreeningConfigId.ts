import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/ScreeningError.js';

export type OrganizationScreeningConfigId = Brand<string, 'OrganizationScreeningConfigId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createOrganizationScreeningConfigId(value: string): OrganizationScreeningConfigId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('OrganizationScreeningConfigId must be a 24-character hexadecimal ObjectId', {
      value,
    });
  }
  return brand<string, 'OrganizationScreeningConfigId'>(value);
}

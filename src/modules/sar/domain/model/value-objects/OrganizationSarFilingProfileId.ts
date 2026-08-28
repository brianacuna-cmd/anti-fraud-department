import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/SarError.js';

export type OrganizationSarFilingProfileId = Brand<string, 'OrganizationSarFilingProfileId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createOrganizationSarFilingProfileId(
  value: string,
): OrganizationSarFilingProfileId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation(
      'OrganizationSarFilingProfileId must be a 24-character hexadecimal ObjectId',
      { value },
    );
  }
  return brand<string, 'OrganizationSarFilingProfileId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateOrganizationSarFilingProfileId(): OrganizationSarFilingProfileId {
  return brand<string, 'OrganizationSarFilingProfileId'>(generateObjectIdHex());
}

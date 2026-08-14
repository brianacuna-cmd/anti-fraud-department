import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type EnforcementActionId = Brand<string, 'EnforcementActionId'>;

export function createEnforcementActionId(value: string): EnforcementActionId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('EnforcementActionId must be a 24-character hexadecimal ObjectId', {
      value,
    });
  }
  return brand<string, 'EnforcementActionId'>(value);
}

export function generateEnforcementActionId(): EnforcementActionId {
  return brand<string, 'EnforcementActionId'>(generateObjectIdHex());
}

import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type CustomerOutgoingEventId = Brand<string, 'CustomerOutgoingEventId'>;

export function createCustomerOutgoingEventId(value: string): CustomerOutgoingEventId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation(
      'CustomerOutgoingEventId must be a 24-character hexadecimal ObjectId',
      { value },
    );
  }
  return brand<string, 'CustomerOutgoingEventId'>(value);
}

export function generateCustomerOutgoingEventId(): CustomerOutgoingEventId {
  return brand<string, 'CustomerOutgoingEventId'>(generateObjectIdHex());
}

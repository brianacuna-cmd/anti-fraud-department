import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type OutboxEventId = Brand<string, 'OutboxEventId'>;

export function createOutboxEventId(value: string): OutboxEventId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('OutboxEventId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'OutboxEventId'>(value);
}

export function generateOutboxEventId(): OutboxEventId {
  return brand<string, 'OutboxEventId'>(generateObjectIdHex());
}

import { brand, type Brand } from '../kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../kernel/ObjectIdHex.js';
import { outboxInvariant } from './OutboxError.js';

export type OutboxEventId = Brand<string, 'OutboxEventId'>;

export function createOutboxEventId(value: string): OutboxEventId {
  if (!isObjectIdHex(value)) {
    throw outboxInvariant('OutboxEventId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'OutboxEventId'>(value);
}

export function generateOutboxEventId(): OutboxEventId {
  return brand<string, 'OutboxEventId'>(generateObjectIdHex());
}

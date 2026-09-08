import { brand, type Brand } from '../kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../kernel/ObjectIdHex.js';
import { scheduledJobInvariant } from './ScheduledJobError.js';

export type ScheduledJobId = Brand<string, 'ScheduledJobId'>;

export function createScheduledJobId(value: string): ScheduledJobId {
  if (!isObjectIdHex(value)) {
    throw scheduledJobInvariant('ScheduledJobId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'ScheduledJobId'>(value);
}

export function generateScheduledJobId(): ScheduledJobId {
  return brand<string, 'ScheduledJobId'>(generateObjectIdHex());
}

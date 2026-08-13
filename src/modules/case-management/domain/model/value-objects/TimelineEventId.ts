import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type TimelineEventId = Brand<string, 'TimelineEventId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createTimelineEventId(value: string): TimelineEventId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('TimelineEventId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'TimelineEventId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateTimelineEventId(): TimelineEventId {
  return brand<string, 'TimelineEventId'>(generateObjectIdHex());
}

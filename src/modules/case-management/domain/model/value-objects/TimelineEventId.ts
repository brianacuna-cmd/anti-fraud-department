import { randomBytes } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type TimelineEventId = Brand<string, 'TimelineEventId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createTimelineEventId(value: string): TimelineEventId {
  if (value.trim().length === 0) {
    throw invariantViolation('TimelineEventId must be a non-empty string', { value });
  }
  return brand<string, 'TimelineEventId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateTimelineEventId(): TimelineEventId {
  return brand<string, 'TimelineEventId'>(randomBytes(12).toString('hex'));
}

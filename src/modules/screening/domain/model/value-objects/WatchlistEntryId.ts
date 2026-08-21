import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/ScreeningError.js';

export type WatchlistEntryId = Brand<string, 'WatchlistEntryId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createWatchlistEntryId(value: string): WatchlistEntryId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('WatchlistEntryId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'WatchlistEntryId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateWatchlistEntryId(): WatchlistEntryId {
  return brand<string, 'WatchlistEntryId'>(generateObjectIdHex());
}

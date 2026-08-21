import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/ScreeningError.js';

export type WatchlistId = Brand<string, 'WatchlistId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createWatchlistId(value: string): WatchlistId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('WatchlistId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'WatchlistId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateWatchlistId(): WatchlistId {
  return brand<string, 'WatchlistId'>(generateObjectIdHex());
}

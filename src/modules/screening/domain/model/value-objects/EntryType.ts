import { invariantViolation } from '../../errors/ScreeningError.js';

export type EntryType = 'PERSON' | 'ORGANIZATION' | 'WALLET';

const VALID_ENTRY_TYPES: ReadonlySet<string> = new Set<EntryType>(['PERSON', 'ORGANIZATION', 'WALLET']);

export function createEntryType(value: string): EntryType {
  if (!VALID_ENTRY_TYPES.has(value)) {
    throw invariantViolation('EntryType must be one of PERSON, ORGANIZATION, WALLET', { value });
  }
  return value as EntryType;
}

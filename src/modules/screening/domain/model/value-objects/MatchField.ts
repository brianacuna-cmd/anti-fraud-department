import { invariantViolation } from '../../errors/ScreeningError.js';

export type MatchField = 'NAME' | 'DOCUMENT' | 'WALLET';

const VALID_MATCH_FIELDS: ReadonlySet<string> = new Set<MatchField>(['NAME', 'DOCUMENT', 'WALLET']);

export function createMatchField(value: string): MatchField {
  if (!VALID_MATCH_FIELDS.has(value)) {
    throw invariantViolation('MatchField must be one of NAME, DOCUMENT, WALLET', { value });
  }
  return value as MatchField;
}

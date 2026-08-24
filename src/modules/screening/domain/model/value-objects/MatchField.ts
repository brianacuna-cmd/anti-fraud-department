import { invariantViolation } from '../../errors/ScreeningError.js';

export type MatchField = 'NAME' | 'DOCUMENTO' | 'WALLET';

const VALID_MATCH_FIELDS: ReadonlySet<string> = new Set<MatchField>(['NAME', 'DOCUMENTO', 'WALLET']);

export function createMatchField(value: string): MatchField {
  if (!VALID_MATCH_FIELDS.has(value)) {
    throw invariantViolation('MatchField must be one of NAME, DOCUMENTO, WALLET', { value });
  }
  return value as MatchField;
}

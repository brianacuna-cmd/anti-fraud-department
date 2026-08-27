import { isRecord } from './isRecord.js';

/**
 * Defensive, absent-safe extraction of a dotted-path optional string from an
 * unknown/nested payload shape (e.g. a provider webhook's rawPayload/charge
 * object). Returns `undefined` — never throws — whenever any path segment is
 * missing, not an object, or the leaf value is not a non-empty string. This
 * is intentional: a provider payload lacking identity fields must leave
 * screening a safe no-op (RF-7), not fail the ingest.
 */
export function readOptionalStringPath(source: unknown, path: readonly string[]): string | undefined {
  let current: unknown = source;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return typeof current === 'string' && current.trim().length > 0 ? current : undefined;
}

/**
 * Best-effort entryType inference: a wallet address is the strongest signal
 * (crypto rails), otherwise any name/document implies a natural person.
 * Returns undefined when no identity was extracted at all.
 */
export function inferSubjectEntryType(
  name: string | undefined,
  document: string | undefined,
  walletAddress: string | undefined,
): string | undefined {
  if (walletAddress !== undefined) {
    return 'WALLET';
  }
  if (name !== undefined || document !== undefined) {
    return 'PERSON';
  }
  return undefined;
}

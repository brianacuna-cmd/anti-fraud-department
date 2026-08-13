import { createHash } from 'node:crypto';

/**
 * Deterministically maps any readable label to a stable 24-char hex string
 * that MongoDB's driver accepts as a native `ObjectId`. Fixtures keep using
 * human-readable ids (`oid('org-1')`) while surviving the persistence
 * boundary, where mappers call `new ObjectId(id)`. Same label -> same id
 * within and across a test, so cross-references (seed vs. assertion) match.
 */
export function oid(label: string): string {
  return createHash('sha1').update(label).digest('hex').slice(0, 24);
}

import doubleMetaphone from 'talisman/phonetics/double-metaphone.js';
import type { PhoneticEncoder } from '../../../../domain/ports/PhoneticEncoder.js';

/**
 * `talisman` Double Metaphone adapter for the `PhoneticEncoder` port. The
 * only place in the screening module allowed to import `talisman` phonetics.
 *
 * `doubleMetaphone` always returns a `[primary, secondary]` tuple; empty
 * strings are dropped and the remaining keys deduped so non-alphabetic or
 * empty input degrades gracefully to `[]` rather than throwing (per the
 * design's blocking-graceful-fallback edge case).
 */
export class TalismanPhoneticEncoder implements PhoneticEncoder {
  encode(token: string): string[] {
    const [primary, secondary] = doubleMetaphone(token);
    const keys = [primary, secondary].filter((key): key is string => key.length > 0);
    return Array.from(new Set(keys));
  }
}

import type { EvidenceTimestamp } from '../../../../domain/model/aggregates/Evidence.js';
import type { TimestampAuthority } from '../../../../domain/ports/TimestampAuthority.js';

/**
 * Deferred `TimestampAuthority`: records no RFC3161 timestamp yet. Evidence is
 * still registered with its SHA256; a real TSA adapter replaces this behind the
 * port when a provider is chosen (no domain change).
 */
export class NullTimestampAuthority implements TimestampAuthority {
  async requestTimestamp(): Promise<EvidenceTimestamp | null> {
    return null;
  }
}

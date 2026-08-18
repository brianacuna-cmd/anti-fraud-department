import type { EvidenceTimestamp } from '../model/aggregates/Evidence.js';

/**
 * RFC3161 timestamping seam. Requests a trusted timestamp token over an
 * evidence SHA256 hash for chain-of-custody. Returns null when timestamping is
 * deferred (no TSA wired yet) — the composition root selects a real adapter
 * later without touching the domain.
 */
export interface TimestampAuthority {
  requestTimestamp(sha256Hex: string): Promise<EvidenceTimestamp | null>;
}

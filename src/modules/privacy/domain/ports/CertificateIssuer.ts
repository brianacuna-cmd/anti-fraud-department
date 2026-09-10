/**
 * Produces the compliance certificate handed to the subject (PRIV-004) and
 * its fingerprint.
 *
 * A port and not a helper because hashing is I/O-adjacent (`node:crypto`) and
 * the domain stays pure. The aggregate only ever sees the resulting hash.
 */
export interface IssuedCertificate {
  /** Human-readable constancia, ready to send to the subject. */
  readonly document: string;
  /** SHA-256 of `document`, hex-encoded. */
  readonly sha256: string;
}

export interface CertificateInput {
  readonly requestId: string;
  readonly subjectEmail: string;
  readonly type: string;
  readonly resolution: string;
  readonly note: string;
  readonly resolvedAtIso: string;
}

export interface CertificateIssuer {
  issue(input: CertificateInput): IssuedCertificate;
}

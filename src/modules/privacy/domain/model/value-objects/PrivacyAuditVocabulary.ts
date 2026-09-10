/**
 * privacy's OWN closed Action/Resource vocabulary for audit emission. Plain
 * unions, NOT branded — mirrors sar/case-management/risk-assessment.
 *
 * Every one of these is audited for the same reason: a privacy regime is
 * judged on whether the controller can PROVE what it did with a request, and
 * an answer nobody can reconstruct is legally indistinguishable from no
 * answer at all.
 */
export type PrivacyAuditAction =
  /** PRIV-001 — the clock starts here. */
  | 'INGEST_PRIVACY_REQUEST'
  /**
   * PRIV-002 — a package of somebody's personal data was assembled and left
   * the system. This is the highest-risk action in the module: it is the one
   * that could hand a subject's file to the wrong person.
   */
  | 'EXPORT_SUBJECT_DATA'
  /** PRIV-003 — identity fields were masked. Records what survived, and why. */
  | 'ANONYMIZE_SUBJECT_DATA'
  /** PRIV-004 — the tenant's formal answer, with its certificate. */
  | 'RESOLVE_PRIVACY_REQUEST';

export type PrivacyAuditResource = 'privacy_data_request' | 'subject_data';

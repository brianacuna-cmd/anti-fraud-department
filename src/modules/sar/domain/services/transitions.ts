import type { SarReportStatus } from '../model/value-objects/SarReportStatus.js';

/** Lookup table shape shared by every entity's transition table (mirrors case-management's `TransitionTable<S>`). */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

/**
 * No reverse edge out of `APPROVED` — approval locks the content.
 *
 * `FILING_REJECTED -> FILED` is the re-submission path: the report itself is
 * unchanged, what changed is that the regulator accepted it the second time.
 * Nothing leaves `FILED`: amending a filed report is a NEW report carrying
 * its own tracking number, not a mutation of this one.
 */
export const sarReportStatusTransitions: TransitionTable<SarReportStatus> = {
  DRAFT: ['APPROVED'],
  APPROVED: ['FILED', 'FILING_REJECTED'],
  FILED: [],
  FILING_REJECTED: ['FILED'],
};

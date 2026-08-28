import type { SarReportStatus } from '../model/value-objects/SarReportStatus.js';

/** Lookup table shape shared by every entity's transition table (mirrors case-management's `TransitionTable<S>`). */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

/** DRAFT -> APPROVED only. No reverse edge — approval locks the report. */
export const sarReportStatusTransitions: TransitionTable<SarReportStatus> = {
  DRAFT: ['APPROVED'],
  APPROVED: [],
};

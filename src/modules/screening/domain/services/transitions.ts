import type { AmlAlertStatus } from '../model/value-objects/AmlAlertStatus.js';

/**
 * Lookup table shape shared by every entity's transition table (mirrors
 * case-management's `TransitionTable<S>`). `StatusTransitionPolicy` consumes
 * this — never an if/switch cascade.
 */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

/**
 * AmlAlert status edges (spec RF-8: "Independent AmlAlert lifecycle").
 * OPEN -> INVESTIGATING -> RESOLVED | FALSE_POSITIVE. No reverse edges —
 * re-triage of a closed alert is out of scope for this slice.
 */
export const amlAlertStatusTransitions: TransitionTable<AmlAlertStatus> = {
  OPEN: ['INVESTIGATING'],
  INVESTIGATING: ['RESOLVED', 'FALSE_POSITIVE'],
  RESOLVED: [],
  FALSE_POSITIVE: [],
};

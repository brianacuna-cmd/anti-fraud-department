import { invariantViolation } from '../../errors/CaseManagementError.js';

/**
 * Discriminated assignment target (design: "AssignedTo (discriminated VO)").
 * Domain stays reference-only — resolving `id` against Users vs Roles is a
 * read-model concern that lives in the HTTP mapper layer (slice 9), never
 * here. Cross-module ids are stored as plain strings (design ADR-0's
 * "cross-module id = plain string" rule).
 */
export type AssignedToType = 'USER' | 'ROLE';

export interface AssignedTo {
  readonly type: AssignedToType;
  readonly id: string;
}

const VALID_TYPES: ReadonlySet<string> = new Set<AssignedToType>(['USER', 'ROLE']);

export function createAssignedTo(type: string, id: string): AssignedTo {
  if (!VALID_TYPES.has(type)) {
    throw invariantViolation('AssignedTo.type must be one of USER, ROLE', { type });
  }
  if (id.trim().length === 0) {
    throw invariantViolation('AssignedTo.id must be a non-empty string', { id });
  }
  return { type: type as AssignedToType, id };
}

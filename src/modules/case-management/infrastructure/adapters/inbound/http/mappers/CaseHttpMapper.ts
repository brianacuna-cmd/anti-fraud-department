import type { Case } from '../../../../../domain/model/aggregates/Case.js';

/**
 * Basic response shape (Slice 5) — no `AssignedTo` resolution yet (that
 * lands in Slice 9, per design: "AssignedTo polymorphic resolution lives in
 * the HTTP mapper (two keyed lookups)"). Until then `assignedTo` is always
 * `null` and is returned as-is, with no lookup performed.
 */
export interface CaseResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly customerEmail: string | null;
  readonly bridgeUserId: string | null;
  readonly bridgeWallet: string | null;
  readonly stripeCustomerId: string | null;
  readonly finturuCacheSnapshot: Record<string, unknown> | null;
  readonly riskScore: number;
  readonly status: string;
  readonly priority: string;
  readonly assignedTo: { readonly type: string; readonly id: string } | null;
  readonly dueDate: string | null;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export function toCaseResponse(kase: Case): CaseResponseDto {
  return {
    id: kase.id,
    organizationId: kase.organizationId,
    customerId: kase.customerId,
    customerEmail: kase.customerEmail,
    bridgeUserId: kase.bridgeUserId,
    bridgeWallet: kase.bridgeWallet,
    stripeCustomerId: kase.stripeCustomerId,
    finturuCacheSnapshot: kase.finturuCacheSnapshot,
    riskScore: kase.riskScore,
    status: kase.status,
    priority: kase.priority,
    assignedTo: kase.assignedTo ? { type: kase.assignedTo.type, id: kase.assignedTo.id } : null,
    dueDate: kase.dueDate,
    tags: kase.tags,
    createdAt: kase.createdAt,
    updatedAt: kase.updatedAt,
    deletedAt: kase.deletedAt,
  };
}

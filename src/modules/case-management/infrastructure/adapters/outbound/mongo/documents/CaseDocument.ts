/**
 * Mongo document shape for `Cases` (design: "Persistence — collections,
 * documents, mappers"). `_id` is the aggregate's branded `CaseId` (a
 * `crypto.randomUUID()` string) — never a driver-generated `ObjectId`
 * (mirrors `OrganizationDocument`'s ADR-0 override of the schema .md).
 *
 * `AssignedTo`/`AssignedToType` are stored as two separate columns (mapper
 * splits/joins the `AssignedTo` VO) — design's "resolve via two separate
 * lookups, no `$lookup` union" decision. `DueDate` is the read-model copy
 * owned exclusively by SLA write paths (T2/T6), never mutated independently.
 */
export interface CaseDocument {
  readonly _id: string;
  readonly OrganizationId: string;
  readonly CustomerId: string;
  readonly CustomerEmail: string | null;
  readonly BridgeUserId: string | null;
  readonly BridgeWallet: string | null;
  readonly StripeCustomerId: string | null;
  readonly FinturuReference: Record<string, unknown> | null;
  readonly FinturuCacheSnapshot: Record<string, unknown> | null;
  readonly RiskScore: number;
  readonly Status: string;
  readonly Priority: string;
  readonly AssignedTo: string | null;
  readonly AssignedToType: string | null;
  readonly DueDate: string | null;
  readonly Tags: readonly string[];
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
  readonly DeletedAt: string | null;
}

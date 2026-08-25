/**
 * `FinturuCustomers` document: local copy of the customer directory.
 *
 * `_id` is the source `IdUser` instead of an ObjectId: identity is defined by
 * the system being copied from, and using it directly makes the sync upsert
 * idempotent without a prior lookup.
 */
export interface FinturuCustomerDocument {
  readonly _id: string;
  readonly IdUser: string;
  readonly IdUserBridge: string | null;
  readonly Name: string | null;
  readonly Lastname: string | null;
  readonly Email: string | null;
  readonly Phone: string | null;
  readonly Status: string | null;
  readonly Address: string | null;
  readonly IdCustomer: string | null;
  readonly Wallets: readonly unknown[];
  readonly Transfers: readonly unknown[];
  readonly Stripe: Record<string, unknown> | null;
  readonly RiskScore: number;
  /** All searchable fields concatenated in lowercase: a single regex covers them. */
  readonly SearchText: string;
  readonly SyncedAt: string;
}

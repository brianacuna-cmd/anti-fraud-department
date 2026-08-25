/**
 * Documento de `FinturuCustomers`: copia local del directorio de clientes.
 *
 * `_id` es el `IdUser` de origen en lugar de un ObjectId: la identidad la
 * define el sistema del que se copia, y usarla directamente hace el upsert del
 * sync idempotente sin necesitar una búsqueda previa.
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
  /** Todos los campos buscables concatenados en minúsculas: una sola regex los cubre. */
  readonly SearchText: string;
  readonly SyncedAt: string;
}

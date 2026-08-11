/**
 * Mongo document shape for the `Rol` collection (design "1. `Rol` collection
 * + idempotent seed", user-roles). `_id` is one of the fixed known role ids
 * (`ADMIN`/`SUPERVISOR`/`ANALYST`/`AUDITOR`) — never a driver-generated
 * `ObjectId` (design A1 precedent, same exception as `Organizations`/`Users`).
 */
export interface RolDocument {
  readonly _id: string;
  readonly RoleName: string;
  readonly Status: string;
  readonly CreatedAt: string;
  readonly DeletedAt: string | null;
}

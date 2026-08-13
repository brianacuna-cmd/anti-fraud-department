/**
 * Mongo document shape for the `rol` collection. `_id` is a fixed catalog id
 * (`ADMIN`/`SUPERVISOR`/`ANALYST`/`AUDITOR`) — never an `ObjectId`.
 */

export interface RolDocument {
  readonly _id: string;
  readonly role_name: string;
  readonly status: string;
  readonly created_at: Date;
  readonly deleted_at: Date | null;
}

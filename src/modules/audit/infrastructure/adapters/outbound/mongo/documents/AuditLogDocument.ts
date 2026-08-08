/**
 * Mongo document shape for `AuditLogs` (design D-A8, A2: PascalCase keys,
 * `_id` lowercase exception). Append-only — no `UpdatedAt`/`DeletedAt`
 * fields exist by design; every field is written explicitly by the mapper,
 * including `null`, never omitted (same convention as `SessionDocument`).
 */
export interface AuditLogDocument {
  readonly _id: string;
  readonly OrganizationId: string | null;
  readonly ActorType: string;
  readonly ActorId: string;
  readonly Action: string;
  readonly Resource: string;
  readonly ResourceId: string | null;
  readonly Detail: Record<string, unknown>;
  readonly IpAddress: string | null;
  readonly CreatedAt: string;
}

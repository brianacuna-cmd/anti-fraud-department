/**
 * Mongo document shape for `Users` (design A2: PascalCase collection and
 * field keys), scoped to this slice's fields only. `NotificationPreferences`/
 * `LastLogin` belong to future auth/access-control work — they are out of
 * scope for the `User` aggregate here and are never read or written by this
 * repository. `MiddleName`/`ResetToken`/`Mfa` are in scope as of schema-v2
 * PR5: `ResetToken`/`Mfa` are persistence/domain-only defaults, written but
 * never consumed by any use case in this slice (design A11).
 * `LoginAttempts`/`BlockedUntil` are in scope as of Phase 4 (design D18) —
 * read/written by `ActorCredentialGateway`, never by `patchUserSchema`
 * (user-lifecycle spec: "User Identity Patch"). `RoleId` is in scope as of
 * user-roles PR-1b — every user is created with a role now. `_id` stays
 * lowercase (design A1).
 */
export interface UserDocument {
  readonly _id: string;
  readonly OrganizationId: string;
  readonly Email: string;
  readonly PasswordHash: string;
  readonly FirstName: string;
  readonly MiddleName: string | null;
  readonly LastName: string;
  readonly AvatarUrl: string | null;
  readonly Status: string;
  readonly IsPlatformAdmin: boolean;
  readonly RoleId: string;
  readonly ResetToken: { readonly Hash: string; readonly ExpiresAt: string } | null;
  readonly Mfa: { readonly Secret: string | null; readonly Enabled: boolean; readonly RecoveryCodes: readonly string[] };
  readonly LoginAttempts: number;
  readonly BlockedUntil: string | null;
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
}

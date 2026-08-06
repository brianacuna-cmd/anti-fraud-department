/**
 * Mongo document shape for `Users` (design A2: PascalCase collection and
 * field keys), scoped to this slice's fields only. `RoleIds`/`Mfa`/
 * `NotificationPreferences`/`LoginAttempts`/`LockedUntil`/`LastLogin`/
 * `ResetTokenHash`/`ResetTokenExpires` belong to future auth/access-control
 * work — they are out of scope for the `User` aggregate here and are never
 * read or written by this repository. `_id` stays lowercase (design A1).
 */
export interface UserDocument {
  readonly _id: string;
  readonly OrganizationId: string;
  readonly Email: string;
  readonly PasswordHash: string;
  readonly FirstName: string;
  readonly LastName: string;
  readonly AvatarUrl: string | null;
  readonly Status: string;
  readonly IsPlatformAdmin: boolean;
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
}

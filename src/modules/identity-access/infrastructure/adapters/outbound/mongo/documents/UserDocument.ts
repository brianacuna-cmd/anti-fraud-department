/**
 * Mongo document shape for `users` (MODELO_DATOS_MONGO.md §3), scoped to
 * this slice's fields only. `roleIds`/`mfa`/`notificationPreferences`/
 * `loginAttempts`/`lockedUntil`/`lastLogin`/`resetTokenHash`/
 * `resetTokenExpires` belong to future auth/access-control work — they are
 * out of scope for the `User` aggregate here and are never read or written
 * by this repository.
 */
export interface UserDocument {
  readonly _id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly passwordSalt: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly avatarUrl: string | null;
  readonly status: string;
  readonly isPlatformAdmin: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

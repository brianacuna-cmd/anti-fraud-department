/**
 * identity-access's own closed Action/Resource vocabulary for audit
 * emission (design §5). Plain unions, NOT branded — same rule as
 * `OrganizationStatus`: a closed enum of known values, not an opaque id.
 *
 * The `audit` module's `AuditLogRepository`/`RecordAuditLog` accept plain
 * `string` (audit cannot know other modules' vocabulary — same boundary as
 * `shared` not knowing module VOs, design D-A9). Widening from this union to
 * `string` happens implicitly at the `AuditRecorder` -> `RecordAuditLog`
 * bridge in the composition root.
 */
export type IdentityAccessAuditAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'ORGANIZATION_CREATED'
  | 'ORGANIZATION_IDENTITY_UPDATED'
  | 'ORGANIZATION_STATUS_CHANGED'
  | 'ORGANIZATION_SESSIONS_REVOKED'
  | 'USER_CREATED'
  | 'USER_IDENTITY_UPDATED'
  | 'USER_STATUS_CHANGED'
  | 'PLATFORM_ADMIN_PROVISIONED'
  // mfa-user-enrollment PR2: user MFA setup/activate/disable.
  | 'MFA_ENABLED'
  | 'MFA_DISABLED'
  // password-management PR-1 (design "Audit Vocabulary additions"):
  // authenticated change-password.
  | 'PASSWORD_CHANGED'
  // super-admin-auth PR1 (design "Audit Vocabulary additions"): PLATFORM_ADMIN
  // challenge-login outcomes.
  | 'PLATFORM_ADMIN_LOGIN'
  | 'PLATFORM_ADMIN_LOGIN_FAILED'
  // super-admin-auth PR2 (design "Audit Vocabulary additions"): admin key
  // lifecycle — one-time download, rotation, revocation.
  | 'PLATFORM_ADMIN_PRIVATE_KEY_DOWNLOADED'
  | 'PLATFORM_ADMIN_KEY_ROTATED'
  | 'PLATFORM_ADMIN_KEY_REVOKED';

export type IdentityAccessAuditResource = 'organizations' | 'users' | 'sessions' | 'adminOrganizations';

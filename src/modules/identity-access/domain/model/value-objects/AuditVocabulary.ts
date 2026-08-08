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
  | 'PLATFORM_ADMIN_PROVISIONED';

export type IdentityAccessAuditResource = 'organizations' | 'users' | 'sessions' | 'adminOrganizations';

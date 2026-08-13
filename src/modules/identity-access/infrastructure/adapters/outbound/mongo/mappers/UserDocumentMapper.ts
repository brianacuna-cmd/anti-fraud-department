import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { User } from '../../../../../domain/model/aggregates/User.js';
import { createUserId } from '../../../../../domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../../domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../../domain/model/value-objects/PasswordCredential.js';
import { createLifecycleStatus } from '../../../../../domain/model/value-objects/LifecycleStatus.js';
import { createRoleId } from '../../../../../domain/model/value-objects/RoleId.js';
import type { UserDocument } from '../documents/UserDocument.js';

/** camelCase (domain) -> snake_case (Mongo). `_id` stays lowercase. */
export function toDocument(user: User): UserDocument {
  return {
    _id: new ObjectId(user.id),
    organization_id: new ObjectId(user.organizationId),
    email: user.email,
    password_hash: user.credential.passwordHash,
    first_name: user.firstName,
    middle_name: user.middleName,
    last_name: user.lastName,
    avatar_url: user.avatarUrl,
    status: user.status,
    is_platform_admin: user.isPlatformAdmin,
    role_id: user.roleId,
    reset_token:
      user.resetToken === null ? null : { hash: user.resetToken.hash, expires_at: toDate(user.resetToken.expiresAt) },
    mfa: { secret: user.mfa.secret, enabled: user.mfa.enabled, recovery_codes: [...user.mfa.recoveryCodes] },
    login_attempts: user.lockout.loginAttempts,
    blocked_until: user.lockout.blockedUntil === null ? null : toDate(user.lockout.blockedUntil),
    created_at: toDate(user.createdAt),
    updated_at: toDate(user.updatedAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: UserDocument): User {
  return User.rehydrate({
    id: createUserId(document._id.toString()),
    organizationId: createOrganizationId(document.organization_id.toString()),
    email: createEmail(document.email),
    credential: createPasswordCredential(document.password_hash),
    firstName: document.first_name,
    middleName: document.middle_name,
    lastName: document.last_name,
    avatarUrl: document.avatar_url,
    status: createLifecycleStatus(document.status),
    isPlatformAdmin: document.is_platform_admin,
    roleId: createRoleId(document.role_id),
    resetToken:
      document.reset_token === null
        ? null
        : { hash: document.reset_token.hash, expiresAt: fromDate(document.reset_token.expires_at) },
    mfa: {
      secret: document.mfa.secret,
      enabled: document.mfa.enabled,
      recoveryCodes: [...document.mfa.recovery_codes],
    },
    lockout: {
      loginAttempts: document.login_attempts,
      blockedUntil: document.blocked_until === null ? null : fromDate(document.blocked_until),
    },
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

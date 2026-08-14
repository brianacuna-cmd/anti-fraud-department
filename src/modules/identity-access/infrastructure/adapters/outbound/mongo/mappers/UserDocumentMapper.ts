import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { User } from '../../../../../domain/model/aggregates/User.js';
import { createUserId } from '../../../../../domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../../domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../../domain/model/value-objects/PasswordCredential.js';
import { createLifecycleStatus } from '../../../../../domain/model/value-objects/LifecycleStatus.js';
import { createRoleId } from '../../../../../domain/model/value-objects/RoleId.js';
import type { UserDocument } from '../documents/UserDocument.js';

/**
 * camelCase (domain) -> PascalCase (Mongo) translation seam (design A2).
 * `_id` is the sole documented exception and stays lowercase (design A1).
 */
export function toDocument(user: User): UserDocument {
  return {
    _id: user.id,
    OrganizationId: user.organizationId,
    Email: user.email,
    PasswordHash: user.credential.passwordHash,
    FirstName: user.firstName,
    MiddleName: user.middleName,
    LastName: user.lastName,
    AvatarUrl: user.avatarUrl,
    Status: user.status,
    IsPlatformAdmin: user.isPlatformAdmin,
    RoleId: user.roleId,
    ResetToken:
      user.resetToken === null ? null : { Hash: user.resetToken.hash, ExpiresAt: user.resetToken.expiresAt },
    Mfa: { Secret: user.mfa.secret, Enabled: user.mfa.enabled, RecoveryCodes: [...user.mfa.recoveryCodes] },
    LoginAttempts: user.lockout.loginAttempts,
    BlockedUntil: user.lockout.blockedUntil,
    CreatedAt: user.createdAt,
    UpdatedAt: user.updatedAt,
  };
}

/** PascalCase (Mongo) -> camelCase (domain) translation seam (design A2). */
export function toDomain(document: UserDocument): User {
  return User.rehydrate({
    id: createUserId(document._id.toString()),
    organizationId: createOrganizationId(document.OrganizationId.toString()),
    email: createEmail(document.Email),
    credential: createPasswordCredential(document.PasswordHash),
    firstName: document.FirstName,
    middleName: document.MiddleName,
    lastName: document.LastName,
    avatarUrl: document.AvatarUrl,
    status: createLifecycleStatus(document.Status),
    isPlatformAdmin: document.IsPlatformAdmin,
    roleId: createRoleId(document.RoleId),
    resetToken:
      document.ResetToken === null
        ? null
        : { hash: document.ResetToken.Hash, expiresAt: brand<string, 'Instant'>(document.ResetToken.ExpiresAt) },
    mfa: {
      secret: document.Mfa.Secret,
      enabled: document.Mfa.Enabled,
      recoveryCodes: [...document.Mfa.RecoveryCodes],
    },
    lockout: {
      loginAttempts: document.LoginAttempts,
      blockedUntil: document.BlockedUntil === null ? null : brand<string, 'Instant'>(document.BlockedUntil),
    },
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
    updatedAt: brand<string, 'Instant'>(document.UpdatedAt),
  });
}

import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { User } from '../../../../../domain/model/aggregates/User.js';
import { createUserId } from '../../../../../domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../../domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../../domain/model/value-objects/PasswordCredential.js';
import { createLifecycleStatus } from '../../../../../domain/model/value-objects/LifecycleStatus.js';
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
    LastName: user.lastName,
    AvatarUrl: user.avatarUrl,
    Status: user.status,
    IsPlatformAdmin: user.isPlatformAdmin,
    CreatedAt: user.createdAt,
    UpdatedAt: user.updatedAt,
  };
}

/** PascalCase (Mongo) -> camelCase (domain) translation seam (design A2). */
export function toDomain(document: UserDocument): User {
  return User.rehydrate({
    id: createUserId(document._id),
    organizationId: createOrganizationId(document.OrganizationId),
    email: createEmail(document.Email),
    credential: createPasswordCredential(document.PasswordHash),
    firstName: document.FirstName,
    lastName: document.LastName,
    avatarUrl: document.AvatarUrl,
    status: createLifecycleStatus(document.Status),
    isPlatformAdmin: document.IsPlatformAdmin,
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
    updatedAt: brand<string, 'Instant'>(document.UpdatedAt),
  });
}

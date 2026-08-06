import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { User } from '../../../../../domain/model/aggregates/User.js';
import { createUserId } from '../../../../../domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../../domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../../domain/model/value-objects/PasswordCredential.js';
import { createLifecycleStatus } from '../../../../../domain/model/value-objects/LifecycleStatus.js';
import type { UserDocument } from '../documents/UserDocument.js';

export function toDocument(user: User): UserDocument {
  return {
    _id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    passwordHash: user.credential.passwordHash,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    status: user.status,
    isPlatformAdmin: user.isPlatformAdmin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function toDomain(document: UserDocument): User {
  return User.rehydrate({
    id: createUserId(document._id),
    organizationId: createOrganizationId(document.organizationId),
    email: createEmail(document.email),
    credential: createPasswordCredential(document.passwordHash),
    firstName: document.firstName,
    lastName: document.lastName,
    avatarUrl: document.avatarUrl,
    status: createLifecycleStatus(document.status),
    isPlatformAdmin: document.isPlatformAdmin,
    createdAt: brand<string, 'Instant'>(document.createdAt),
    updatedAt: brand<string, 'Instant'>(document.updatedAt),
  });
}

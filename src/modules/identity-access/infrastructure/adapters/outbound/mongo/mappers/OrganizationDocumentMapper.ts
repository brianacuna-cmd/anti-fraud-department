import { ObjectId } from 'mongodb';
import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { Organization } from '../../../../../domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../../domain/model/value-objects/Slug.js';
import { createOrganizationStatus } from '../../../../../domain/model/value-objects/OrganizationStatus.js';
import { createEmail } from '../../../../../domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../../domain/model/value-objects/PasswordCredential.js';
import type { OrganizationDocument } from '../documents/OrganizationDocument.js';

/**
 * camelCase (domain) -> PascalCase (Mongo) translation seam (design A2).
 * `_id` is the sole documented exception and stays lowercase (design A1).
 */
export function toDocument(organization: Organization): OrganizationDocument {
  return {
    _id: new ObjectId(organization.id),
    Name: organization.name,
    Slug: organization.slug,
    Domain: organization.domain,
    Status: organization.status,
    Configuration: organization.configuration,
    Email: organization.email,
    PasswordHash: organization.credential === null ? null : organization.credential.passwordHash,
    LoginAttempts: organization.lockout.loginAttempts,
    BlockedUntil: organization.lockout.blockedUntil,
    CreatedAt: organization.createdAt,
    UpdatedAt: organization.updatedAt,
    DeletedAt: organization.deletedAt,
  };
}

/** PascalCase (Mongo) -> camelCase (domain) translation seam (design A2). */
export function toDomain(document: OrganizationDocument): Organization {
  return Organization.rehydrate({
    id: createOrganizationId(document._id.toString()),
    name: document.Name,
    slug: createSlug(document.Slug),
    domain: document.Domain,
    status: createOrganizationStatus(document.Status),
    configuration: document.Configuration,
    email: document.Email === null ? null : createEmail(document.Email),
    credential: document.PasswordHash === null ? null : createPasswordCredential(document.PasswordHash),
    lockout: {
      loginAttempts: document.LoginAttempts,
      blockedUntil: document.BlockedUntil === null ? null : brand<string, 'Instant'>(document.BlockedUntil),
    },
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
    updatedAt: brand<string, 'Instant'>(document.UpdatedAt),
    deletedAt: document.DeletedAt === null ? null : brand<string, 'Instant'>(document.DeletedAt),
  });
}

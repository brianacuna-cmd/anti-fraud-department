import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { Organization } from '../../../../../domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../../domain/model/value-objects/Slug.js';
import { createOrganizationStatus } from '../../../../../domain/model/value-objects/OrganizationStatus.js';
import { createEmail } from '../../../../../domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../../domain/model/value-objects/PasswordCredential.js';
import type { OrganizationDocument } from '../documents/OrganizationDocument.js';

/** camelCase (domain) -> snake_case (Mongo). `_id` stays lowercase. */
export function toDocument(organization: Organization): OrganizationDocument {
  return {
    _id: new ObjectId(organization.id),
    name: organization.name,
    slug: organization.slug,
    domain: organization.domain,
    status: organization.status,
    configuration: organization.configuration,
    email: organization.email,
    password_hash: organization.credential === null ? null : organization.credential.passwordHash,
    login_attempts: organization.lockout.loginAttempts,
    blocked_until: organization.lockout.blockedUntil === null ? null : toDate(organization.lockout.blockedUntil),
    created_at: toDate(organization.createdAt),
    updated_at: toDate(organization.updatedAt),
    deleted_at: organization.deletedAt === null ? null : toDate(organization.deletedAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: OrganizationDocument): Organization {
  return Organization.rehydrate({
    id: createOrganizationId(document._id.toString()),
    name: document.name,
    slug: createSlug(document.slug),
    domain: document.domain,
    status: createOrganizationStatus(document.status),
    configuration: document.configuration,
    email: document.email === null ? null : createEmail(document.email),
    credential: document.password_hash === null ? null : createPasswordCredential(document.password_hash),
    lockout: {
      loginAttempts: document.login_attempts,
      blockedUntil: document.blocked_until === null ? null : fromDate(document.blocked_until),
    },
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
    deletedAt: document.deleted_at === null ? null : fromDate(document.deleted_at),
  });
}

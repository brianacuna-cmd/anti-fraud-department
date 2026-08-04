import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { Organization } from '../../../../../domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../../domain/model/value-objects/Slug.js';
import { createLifecycleStatus } from '../../../../../domain/model/value-objects/LifecycleStatus.js';
import type { OrganizationDocument } from '../documents/OrganizationDocument.js';

export function toDocument(organization: Organization): OrganizationDocument {
  return {
    _id: organization.id,
    name: organization.name,
    slug: organization.slug,
    domain: organization.domain,
    status: organization.status,
    logoUrl: organization.logoUrl,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

export function toDomain(document: OrganizationDocument): Organization {
  return Organization.rehydrate({
    id: createOrganizationId(document._id),
    name: document.name,
    slug: createSlug(document.slug),
    domain: document.domain,
    status: createLifecycleStatus(document.status),
    logoUrl: document.logoUrl,
    createdAt: brand<string, 'Instant'>(document.createdAt),
    updatedAt: brand<string, 'Instant'>(document.updatedAt),
  });
}

import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { OrganizationSarFilingProfile } from '../../../../../domain/model/aggregates/OrganizationSarFilingProfile.js';
import { createOrganizationSarFilingProfileId } from '../../../../../domain/model/value-objects/OrganizationSarFilingProfileId.js';
import { createPostalAddress, type PostalAddress } from '../../../../../domain/model/value-objects/PostalAddress.js';
import { createTinType } from '../../../../../domain/model/value-objects/TinType.js';
import type { PostalAddressDocument } from '../documents/SarReportDocument.js';
import type { OrganizationSarFilingProfileDocument } from '../documents/OrganizationSarFilingProfileDocument.js';

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(
  document: OrganizationSarFilingProfileDocument,
): OrganizationSarFilingProfile {
  return OrganizationSarFilingProfile.rehydrate({
    id: createOrganizationSarFilingProfileId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    filerName: document.filer_name,
    filerTin: document.filer_tin,
    filerTinType: createTinType(document.filer_tin_type),
    filerAddress: toAddress(document.filer_address),
    contactName: document.contact_name,
    contactPhone: document.contact_phone,
    contactEmail: document.contact_email,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

/** camelCase (domain) -> snake_case (Mongo). */
export function toDocument(
  profile: OrganizationSarFilingProfile,
): OrganizationSarFilingProfileDocument {
  return {
    _id: new ObjectId(profile.id),
    organization_id: new ObjectId(profile.organizationId),
    filer_name: profile.filerName,
    filer_tin: profile.filerTin,
    filer_tin_type: profile.filerTinType,
    filer_address: toAddressDocument(profile.filerAddress),
    contact_name: profile.contactName,
    contact_phone: profile.contactPhone,
    contact_email: profile.contactEmail,
    created_at: toDate(profile.createdAt),
    updated_at: toDate(profile.updatedAt),
  };
}

function toAddress(document: PostalAddressDocument): PostalAddress {
  return createPostalAddress({
    street: document.street,
    city: document.city,
    state: document.state,
    postalCode: document.postal_code,
    country: document.country,
  });
}

function toAddressDocument(address: PostalAddress): PostalAddressDocument {
  return {
    street: address.street,
    city: address.city,
    state: address.state,
    postal_code: address.postalCode,
    country: address.country,
  };
}

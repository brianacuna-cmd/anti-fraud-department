import type { Organization } from '../../../../../domain/model/aggregates/Organization.js';
import type { OrganizationListPage } from '../../../../../domain/ports/OrganizationRepository.js';

/** `logoUrl` is removed with no replacement field (design D8); `configuration` is persistence/domain-only and never exposed here (design A11). */
export interface OrganizationResponseDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly domain: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface OrganizationListResponseDto {
  readonly items: readonly OrganizationResponseDto[];
  readonly nextCursor: string | null;
}

export function toOrganizationResponse(organization: Organization): OrganizationResponseDto {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    domain: organization.domain,
    status: organization.status,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    deletedAt: organization.deletedAt,
  };
}

export function toOrganizationListResponse(page: OrganizationListPage): OrganizationListResponseDto {
  return {
    items: page.items.map(toOrganizationResponse),
    nextCursor: page.nextCursor,
  };
}

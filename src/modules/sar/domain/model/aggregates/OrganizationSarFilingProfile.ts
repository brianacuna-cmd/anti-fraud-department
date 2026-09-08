import type { Instant } from '../../../../../shared/time/Instant.js';
import type { OrganizationSarFilingProfileId } from '../value-objects/OrganizationSarFilingProfileId.js';
import type { PostalAddress } from '../value-objects/PostalAddress.js';
import type { TinType } from '../value-objects/TinType.js';
import { invariantViolation } from '../../errors/SarError.js';

export interface OrganizationSarFilingProfileProps {
  readonly id: OrganizationSarFilingProfileId;
  readonly organizationId: string;
  /** Legal name of the institution that files, not its commercial brand. */
  readonly filerName: string;
  readonly filerTin: string;
  readonly filerTinType: TinType;
  readonly filerAddress: PostalAddress;
  /** Who a regulator calls about this filing. */
  readonly contactName: string;
  readonly contactPhone: string;
  readonly contactEmail: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface UpsertOrganizationSarFilingProfileInput {
  readonly id: OrganizationSarFilingProfileId;
  readonly organizationId: string;
  readonly filerName: string;
  readonly filerTin: string;
  readonly filerTinType: TinType;
  readonly filerAddress: PostalAddress;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly contactEmail?: string | null;
  readonly now: Instant;
}

/**
 * Per-tenant singleton: who this organization IS when it files a report.
 *
 * It lives apart from `SarReport` because it belongs to the institution, not
 * to each report — copying the same TIN and address into every SAR is how
 * two hundred reports end up carrying an address the institution moved out
 * of a year ago. Uniqueness (one document per organization) is enforced by
 * the `sar_filing_profile_unique` index, not here, mirroring
 * `OrganizationScreeningConfig`.
 *
 * A MISSING profile is not an error at read time — it is the ordinary state
 * of a tenant that has not configured filing yet. It becomes an error only
 * when someone tries to generate a report file, and `SarFilingReadiness`
 * names exactly what is missing.
 */
export class OrganizationSarFilingProfile {
  private constructor(private readonly props: OrganizationSarFilingProfileProps) {}

  static create(
    input: UpsertOrganizationSarFilingProfileInput,
  ): OrganizationSarFilingProfile {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('filerName', input.filerName);
    assertNonEmpty('contactName', input.contactName);
    assertNonEmpty('contactPhone', input.contactPhone);
    assertTin(input.filerTin, input.filerTinType);

    return new OrganizationSarFilingProfile({
      id: input.id,
      organizationId: input.organizationId,
      filerName: input.filerName.trim(),
      filerTin: input.filerTin.trim(),
      filerTinType: input.filerTinType,
      filerAddress: input.filerAddress,
      contactName: input.contactName.trim(),
      contactPhone: input.contactPhone.trim(),
      contactEmail: input.contactEmail?.trim() || null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: OrganizationSarFilingProfileProps): OrganizationSarFilingProfile {
    return new OrganizationSarFilingProfile(props);
  }

  /** Replaces every editable field, keeping identity and `createdAt`. */
  update(
    input: Omit<UpsertOrganizationSarFilingProfileInput, 'id' | 'organizationId'>,
  ): OrganizationSarFilingProfile {
    const replaced = OrganizationSarFilingProfile.create({
      ...input,
      id: this.props.id,
      organizationId: this.props.organizationId,
    });
    return new OrganizationSarFilingProfile({
      ...replaced.props,
      createdAt: this.props.createdAt,
      updatedAt: input.now,
    });
  }

  get id(): OrganizationSarFilingProfileId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get filerName(): string {
    return this.props.filerName;
  }

  get filerTin(): string {
    return this.props.filerTin;
  }

  get filerTinType(): TinType {
    return this.props.filerTinType;
  }

  get filerAddress(): PostalAddress {
    return this.props.filerAddress;
  }

  get contactName(): string {
    return this.props.contactName;
  }

  get contactPhone(): string {
    return this.props.contactPhone;
  }

  get contactEmail(): string | null {
    return this.props.contactEmail;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): OrganizationSarFilingProfileProps {
    return this.props;
  }
}

/**
 * An EIN is nine digits. Rejecting a malformed one here is the difference
 * between a filing bounced by FinCEN weeks later and a form that will not
 * save now.
 */
function assertTin(tin: string, type: TinType): void {
  const trimmed = tin.trim();
  if (trimmed.length === 0) {
    throw invariantViolation('filerTin must be a non-empty string', {});
  }
  if ((type === 'EIN' || type === 'SSN_ITIN') && !/^\d{9}$/.test(trimmed.replace(/-/g, ''))) {
    throw invariantViolation('a US filerTin must be nine digits', { filerTin: tin, filerTinType: type });
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`OrganizationSarFilingProfile ${field} must be a non-empty string`, {
      field,
    });
  }
}

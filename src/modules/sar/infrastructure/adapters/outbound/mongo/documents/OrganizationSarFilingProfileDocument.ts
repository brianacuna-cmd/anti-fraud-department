/**
 * Mongo document shape for `organization_sar_filing_profile`. One document
 * per organization, enforced by `sar_filing_profile_unique`.
 */

import type { ObjectId } from 'mongodb';
import type { PostalAddressDocument } from './SarReportDocument.js';

export interface OrganizationSarFilingProfileDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly filer_name: string;
  readonly filer_tin: string;
  readonly filer_tin_type: string;
  readonly filer_address: PostalAddressDocument;
  readonly contact_name: string;
  readonly contact_phone: string;
  readonly contact_email: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

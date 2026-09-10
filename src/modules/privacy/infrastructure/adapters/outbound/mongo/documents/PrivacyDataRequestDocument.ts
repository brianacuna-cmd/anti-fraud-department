/**
 * Mongo document shape for `privacy_data_requests`. `_id` is the aggregate's
 * branded `PrivacyDataRequestId` stored as a native BSON `ObjectId`;
 * `organization_id` is an ObjectId FK. `subject_customer_id` is a
 * cross-module identifier, so it stays a plain string.
 */

import type { ObjectId } from 'mongodb';

export interface PrivacyDataRequestDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly subject_email: string;
  readonly subject_customer_id: string | null;
  readonly type: string;
  readonly status: string;
  readonly requester_note: string | null;
  readonly received_at: Date;
  readonly due_at: Date;
  readonly resolution: string | null;
  readonly resolution_note: string | null;
  readonly certificate_sha256: string | null;
  readonly resolved_by: string | null;
  readonly resolved_at: Date | null;
  readonly created_by: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/**
 * Mongo document shape for `organization_screening_config`. One document
 * per organization, enforced by `org_screening_config_unique`.
 */

import type { ObjectId } from 'mongodb';

export interface OrganizationScreeningConfigDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly alert_threshold: number;
  readonly signal_threshold: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

import type { ObjectId } from 'mongodb';

export interface EnforcementActionDocument {
  readonly _id: ObjectId;
  readonly case_id: ObjectId;
  readonly organization_id: ObjectId;
  readonly analyst_decision_id: ObjectId;
  readonly action_type: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly status: string;
  readonly created_by: ObjectId;
  readonly created_at: Date;
  readonly updated_at: Date;
}

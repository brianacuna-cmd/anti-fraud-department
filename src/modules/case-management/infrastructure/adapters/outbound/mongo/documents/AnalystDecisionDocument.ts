import type { ObjectId } from 'mongodb';

export interface AnalystDecisionDocument {
  readonly _id: ObjectId;
  readonly case_id: ObjectId;
  readonly organization_id: ObjectId;
  readonly decision: string;
  readonly confidence: number;
  readonly comment: string;
  readonly created_by: ObjectId;
  readonly created_at: Date;
}

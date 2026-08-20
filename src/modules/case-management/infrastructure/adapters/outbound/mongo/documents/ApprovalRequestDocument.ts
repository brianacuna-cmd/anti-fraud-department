import type { ObjectId } from 'mongodb';

export interface ApprovalRequestDocument {
  readonly _id: ObjectId;
  readonly enforcement_action_id: ObjectId;
  readonly requester_id: ObjectId;
  readonly reviewer_id: ObjectId | null;
  readonly status: string;
  readonly reviewer_comment: string | null;
  readonly created_at: Date;
  readonly reviewed_at: Date | null;
}

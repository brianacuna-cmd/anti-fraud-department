import type { ObjectId } from 'mongodb';

export interface CustomerOutgoingEventPayloadDocument {
  readonly enforcement_action_id: string;
  readonly case_id: string;
  readonly action_type: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly organization_id: string;
}

export interface CustomerOutgoingEventDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly customer_id: string;
  readonly enforcement_action_id: ObjectId;
  readonly webhook_url: string;
  readonly event_type: string;
  readonly payload: CustomerOutgoingEventPayloadDocument;
  readonly status: string;
  readonly response_status: number | null;
  readonly attempts: number;
  readonly last_attempt_at: Date | null;
  readonly created_at: Date;
}

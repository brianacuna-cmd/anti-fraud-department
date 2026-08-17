import type { ObjectId } from 'mongodb';

export interface OutboxEventDocument {
  readonly _id: ObjectId;
  readonly AggregateType: string;
  readonly AggregateId: string;
  readonly EventType: string;
  readonly Payload: Record<string, unknown>;
  readonly Status: string;
  readonly CreatedAt: string;
  readonly PublishedAt: string | null;
  readonly Error: string | null;
}

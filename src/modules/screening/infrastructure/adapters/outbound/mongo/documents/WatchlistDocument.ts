/**
 * Mongo document shape for `watchlists`. `_id` is the aggregate's branded
 * `WatchlistId` stored as a native BSON `ObjectId`. `organization_id` is an
 * ObjectId FK. Instant fields are BSON `Date`.
 */

import type { ObjectId } from 'mongodb';

export interface WatchlistDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly name: string;
  readonly source: string;
  readonly type: string;
  readonly description: string | null;
  readonly status: string;
  readonly deleted_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  /** AML-001: last applied sync of an official list; absent on every other watchlist. */
  readonly last_synced_at?: Date | null;
}

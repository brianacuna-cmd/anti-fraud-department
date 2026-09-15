import { ObjectId, type Collection, type Db } from 'mongodb';
import type { PollCursorRepository, PollFeed } from '../../../../domain/ports/ProviderEventFeed.js';

export const PROVIDER_POLL_CURSORS_COLLECTION = 'provider_poll_cursors';

interface PollCursorDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly feed: PollFeed;
  readonly cursor: string;
  readonly updated_at: Date;
}

/** One row per (organization, feed), replaced on every successful poll. */
export class MongoPollCursorRepository implements PollCursorRepository {
  private readonly collection: Collection<PollCursorDocument>;

  constructor(db: Db) {
    this.collection = db.collection<PollCursorDocument>(PROVIDER_POLL_CURSORS_COLLECTION);
  }

  async get(organizationId: string, feed: PollFeed): Promise<string | null> {
    const row = await this.collection.findOne({ organization_id: new ObjectId(organizationId), feed });
    return row?.cursor ?? null;
  }

  async save(organizationId: string, feed: PollFeed, cursor: string): Promise<void> {
    await this.collection.updateOne(
      { organization_id: new ObjectId(organizationId), feed },
      { $set: { cursor, updated_at: new Date() } },
      { upsert: true },
    );
  }
}

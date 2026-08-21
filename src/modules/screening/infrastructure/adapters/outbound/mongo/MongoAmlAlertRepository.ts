import type { Collection, Db, Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { AmlAlert } from '../../../../domain/model/aggregates/AmlAlert.js';
import type { AmlAlertId } from '../../../../domain/model/value-objects/AmlAlertId.js';
import type { AmlAlertRepository } from '../../../../domain/ports/AmlAlertRepository.js';
import { isDuplicateKeyError } from '../../../../../../shared/persistence/mongo/duplicateKey.js';
import type { AmlAlertDocument } from './documents/AmlAlertDocument.js';
import { toDocument, toDomain } from './mappers/AmlAlertDocumentMapper.js';

const COLLECTION_NAME = 'aml_alerts';

/** Builds the natural-key filter (spec RF-6: organization + customer + matched entry + match_field). */
function naturalKeyFilter(document: AmlAlertDocument): Filter<AmlAlertDocument> {
  return {
    organization_id: document.organization_id,
    customer_id: document.customer_id,
    'matched_entry.entry_id': document.matched_entry.entry_id,
    'matched_entry.match_field': document.matched_entry.match_field,
  };
}

/**
 * Mongo adapter for `AmlAlertRepository`. `save` is idempotent on the
 * natural key via existence-check-then-skip (spec RF-6): a repeated save
 * for the same (organization, customer, matched entry, match_field) is a
 * no-op, so outbox redelivery never creates a duplicate `aml_alerts`
 * record. A unique index on that same key (`aml_alerts_natural_key_unique`,
 * see `src/shared/persistence/mongo/ensureIndexes.ts`) backs this against
 * races.
 */
export class MongoAmlAlertRepository implements AmlAlertRepository {
  private readonly collection: Collection<AmlAlertDocument>;

  constructor(db: Db) {
    this.collection = db.collection<AmlAlertDocument>(COLLECTION_NAME);
  }

  async save(alert: AmlAlert): Promise<void> {
    const document = toDocument(alert);
    const existing = await this.collection.findOne(naturalKeyFilter(document), { projection: { _id: 1 } });
    if (existing) {
      return;
    }
    try {
      await this.collection.insertOne(document);
    } catch (error) {
      // Concurrent save for the same natural key: the unique index
      // (`aml_alerts_natural_key_unique`) rejects the loser with E11000.
      // The alert already exists, so treat it as an idempotent no-op (RF-6)
      // rather than propagating a failure to `persistAlerts`.
      if (isDuplicateKeyError(error)) {
        return;
      }
      throw error;
    }
  }

  async findById(id: AmlAlertId): Promise<AmlAlert | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) });
    return document ? toDomain(document) : null;
  }
}

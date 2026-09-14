import { ObjectId } from 'mongodb';
import { toDate } from '../../../../../../../shared/time/Instant.js';
import { EntityChange } from '../../../../../domain/model/aggregates/EntityChange.js';
import type { EntityChangeDocument } from '../documents/EntityChangeDocument.js';

export function toDocument(change: EntityChange): EntityChangeDocument {
  return {
    _id: new ObjectId(change.id),
    organization_id: change.organizationId === null ? null : new ObjectId(change.organizationId),
    entity_type: change.entityType,
    entity_id: change.entityId,
    actor_type: change.actorType,
    actor_id: change.actorId,
    mutations: change.mutations.map((m) => ({
      field: m.field,
      previous_value: m.previousValue,
      new_value: m.newValue,
    })),
    created_at: toDate(change.createdAt),
  };
}

import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { EntityChange } from '../../../../../domain/model/aggregates/EntityChange.js';
import { createAuditLogId } from '../../../../../domain/model/value-objects/AuditLogId.js';
import type { ActorType } from '../../../../../domain/model/ActorType.js';
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

export function toDomain(document: EntityChangeDocument): EntityChange {
  return EntityChange.rehydrate({
    id: createAuditLogId(document._id.toHexString()),
    organizationId: document.organization_id === null ? null : document.organization_id.toHexString(),
    entityType: document.entity_type,
    entityId: document.entity_id,
    actorType: document.actor_type as ActorType,
    actorId: document.actor_id,
    mutations: document.mutations.map((m) => ({
      field: m.field,
      previousValue: m.previous_value,
      newValue: m.new_value,
    })),
    createdAt: fromDate(document.created_at),
  });
}

import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { AuditLog } from '../../../../../domain/model/aggregates/AuditLog.js';
import { createAuditLogId } from '../../../../../domain/model/value-objects/AuditLogId.js';
import type { ActorType } from '../../../../../domain/model/ActorType.js';
import type { AuditLogDocument } from '../documents/AuditLogDocument.js';

/**
 * camelCase (domain) -> PascalCase (Mongo) translation seam (design A2).
 * `_id` is the sole documented exception and stays lowercase (design A1).
 * Every nullable field is written explicitly, never omitted.
 */
export function toDocument(auditLog: AuditLog): AuditLogDocument {
  return {
    _id: auditLog.id,
    OrganizationId: auditLog.organizationId,
    ActorType: auditLog.actorType,
    ActorId: auditLog.actorId,
    Action: auditLog.action,
    Resource: auditLog.resource,
    ResourceId: auditLog.resourceId,
    Detail: auditLog.detail,
    IpAddress: auditLog.ipAddress,
    CreatedAt: auditLog.createdAt,
  };
}

/** PascalCase (Mongo) -> camelCase (domain) translation seam (design A2). */
export function toDomain(document: AuditLogDocument): AuditLog {
  return AuditLog.rehydrate({
    id: createAuditLogId(document._id),
    organizationId: document.OrganizationId,
    actorType: document.ActorType as ActorType,
    actorId: document.ActorId,
    action: document.Action,
    resource: document.Resource,
    resourceId: document.ResourceId,
    detail: document.Detail,
    ipAddress: document.IpAddress,
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
  });
}

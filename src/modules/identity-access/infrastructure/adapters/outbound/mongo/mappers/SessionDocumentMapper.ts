import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { Session } from '../../../../../domain/model/aggregates/Session.js';
import { createSessionId } from '../../../../../domain/model/value-objects/SessionId.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createAdminOrganizationId } from '../../../../../domain/model/value-objects/AdminOrganizationId.js';
import type { SessionDocument } from '../documents/SessionDocument.js';

/** camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`. */
export function toDocument(session: Session): SessionDocument {
  return {
    _id: new ObjectId(session.id),
    user_id: session.userId === null ? null : new ObjectId(session.userId),
    organization_id: session.organizationId === null ? null : new ObjectId(session.organizationId),
    admin_organization_id:
      session.adminOrganizationId === null ? null : new ObjectId(session.adminOrganizationId),
    token_hash: session.tokenHash,
    ip_address: session.ipAddress,
    user_agent: session.userAgent,
    expira_en: toDate(session.expiresAt),
    created_at: toDate(session.createdAt),
    deleted_at: session.deletedAt === null ? null : toDate(session.deletedAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: SessionDocument): Session {
  return Session.rehydrate({
    id: createSessionId(document._id.toString()),
    userId: document.user_id === null ? null : document.user_id.toString(),
    organizationId:
      document.organization_id === null ? null : createOrganizationId(document.organization_id.toString()),
    adminOrganizationId:
      document.admin_organization_id === null
        ? null
        : createAdminOrganizationId(document.admin_organization_id.toString()),
    tokenHash: document.token_hash,
    expiresAt: fromDate(document.expira_en),
    ipAddress: document.ip_address,
    userAgent: document.user_agent,
    createdAt: fromDate(document.created_at),
    deletedAt: document.deleted_at === null ? null : fromDate(document.deleted_at),
  });
}

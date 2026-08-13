import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { Session } from '../../../../../domain/model/aggregates/Session.js';
import { createSessionId } from '../../../../../domain/model/value-objects/SessionId.js';
import { createFamilyId } from '../../../../../domain/model/value-objects/FamilyId.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createActorType } from '../../../../../domain/model/value-objects/ActorType.js';
import type { SessionDocument } from '../documents/SessionDocument.js';

/**
 * camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`.
 * `refresh_token_hash`/`refresh_expires_at` are written explicitly — even when
 * `null` — never omitted (partial unique index precondition).
 */
export function toDocument(session: Session): SessionDocument {
  return {
    _id: new ObjectId(session.id),
    user_id: session.userId === null ? null : new ObjectId(session.userId),
    organization_id: session.organizationId === null ? null : new ObjectId(session.organizationId),
    actor_type: session.actorType,
    token_hash: session.tokenHash,
    refresh_token_hash: session.refreshTokenHash,
    expires_at: toDate(session.expiresAt),
    refresh_expires_at: session.refreshExpiresAt === null ? null : toDate(session.refreshExpiresAt),
    family_id: new ObjectId(session.familyId),
    family_expires_at: toDate(session.familyExpiresAt),
    rotated_at: session.rotatedAt === null ? null : toDate(session.rotatedAt),
    rotated_from_session_id:
      session.rotatedFromSessionId === null ? null : new ObjectId(session.rotatedFromSessionId),
    created_at: toDate(session.createdAt),
    updated_at: toDate(session.updatedAt),
    deleted_at: session.deletedAt === null ? null : toDate(session.deletedAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: SessionDocument): Session {
  return Session.rehydrate({
    id: createSessionId(document._id.toString()),
    userId: document.user_id === null ? null : document.user_id.toString(),
    organizationId: document.organization_id === null ? null : createOrganizationId(document.organization_id.toString()),
    actorType: createActorType(document.actor_type),
    tokenHash: document.token_hash,
    refreshTokenHash: document.refresh_token_hash,
    expiresAt: fromDate(document.expires_at),
    refreshExpiresAt: document.refresh_expires_at === null ? null : fromDate(document.refresh_expires_at),
    familyId: createFamilyId(document.family_id.toString()),
    familyExpiresAt: fromDate(document.family_expires_at),
    rotatedAt: document.rotated_at === null ? null : fromDate(document.rotated_at),
    rotatedFromSessionId:
      document.rotated_from_session_id === null
        ? null
        : createSessionId(document.rotated_from_session_id.toString()),
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
    deletedAt: document.deleted_at === null ? null : fromDate(document.deleted_at),
  });
}

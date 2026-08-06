import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { toDate } from '../../../../../../../shared/time/Instant.js';
import { Session } from '../../../../../domain/model/aggregates/Session.js';
import { createSessionId } from '../../../../../domain/model/value-objects/SessionId.js';
import { createFamilyId } from '../../../../../domain/model/value-objects/FamilyId.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createActorType } from '../../../../../domain/model/value-objects/ActorType.js';
import type { SessionDocument } from '../documents/SessionDocument.js';

/**
 * camelCase (domain) -> PascalCase (Mongo) translation seam (design A2).
 * `_id` is the sole documented exception and stays lowercase (design A1).
 * `RefreshTokenHash`/`RefreshExpiresAt` are written explicitly — even when
 * `null` — never omitted (design D38's partial-index precondition).
 * `FamilyExpiresAtDate` is derived from `FamilyExpiresAt` on every write —
 * the TTL-bearing BSON `Date` mirror (design D15).
 */
export function toDocument(session: Session): SessionDocument {
  return {
    _id: session.id,
    UserId: session.userId,
    OrganizationId: session.organizationId,
    ActorType: session.actorType,
    TokenHash: session.tokenHash,
    RefreshTokenHash: session.refreshTokenHash,
    ExpiresAt: session.expiresAt,
    RefreshExpiresAt: session.refreshExpiresAt,
    FamilyId: session.familyId,
    FamilyExpiresAt: session.familyExpiresAt,
    FamilyExpiresAtDate: toDate(session.familyExpiresAt),
    RotatedAt: session.rotatedAt,
    RotatedFromSessionId: session.rotatedFromSessionId,
    CreatedAt: session.createdAt,
    UpdatedAt: session.updatedAt,
    DeletedAt: session.deletedAt,
  };
}

/** PascalCase (Mongo) -> camelCase (domain) translation seam (design A2). */
export function toDomain(document: SessionDocument): Session {
  return Session.rehydrate({
    id: createSessionId(document._id),
    userId: document.UserId,
    organizationId: document.OrganizationId === null ? null : createOrganizationId(document.OrganizationId),
    actorType: createActorType(document.ActorType),
    tokenHash: document.TokenHash,
    refreshTokenHash: document.RefreshTokenHash,
    expiresAt: brand<string, 'Instant'>(document.ExpiresAt),
    refreshExpiresAt: document.RefreshExpiresAt === null ? null : brand<string, 'Instant'>(document.RefreshExpiresAt),
    familyId: createFamilyId(document.FamilyId),
    familyExpiresAt: brand<string, 'Instant'>(document.FamilyExpiresAt),
    rotatedAt: document.RotatedAt === null ? null : brand<string, 'Instant'>(document.RotatedAt),
    rotatedFromSessionId:
      document.RotatedFromSessionId === null ? null : createSessionId(document.RotatedFromSessionId),
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
    updatedAt: brand<string, 'Instant'>(document.UpdatedAt),
    deletedAt: document.DeletedAt === null ? null : brand<string, 'Instant'>(document.DeletedAt),
  });
}

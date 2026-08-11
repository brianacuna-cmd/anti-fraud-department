import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { createRoleId } from '../../../../../domain/model/value-objects/RoleId.js';
import type { RoleView } from '../../../../../domain/ports/RoleRepository.js';
import type { RolDocument } from '../documents/RolDocument.js';

/**
 * PascalCase (Mongo) -> camelCase (domain) translation seam (design A2).
 * `Rol` is read-only reference data — no `toDocument` (the seed writes raw
 * upsert payloads directly, mirroring `ensureIndexes.ts`'s precedent of not
 * routing bootstrap writes through a domain mapper).
 */
export function toDomain(document: RolDocument): RoleView {
  return {
    id: createRoleId(document._id),
    name: document.RoleName,
    status: document.Status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    deletedAt: document.DeletedAt === null ? null : brand<string, 'Instant'>(document.DeletedAt),
  };
}

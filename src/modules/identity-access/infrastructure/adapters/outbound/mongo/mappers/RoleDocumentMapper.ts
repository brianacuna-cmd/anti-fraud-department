import { fromDate } from '../../../../../../../shared/time/Instant.js';
import { createRoleId } from '../../../../../domain/model/value-objects/RoleId.js';
import type { RoleView } from '../../../../../domain/ports/RoleRepository.js';
import type { RoleDocument } from '../documents/RoleDocument.js';

/**
 * snake_case (Mongo) -> camelCase (domain). `roles` is read-only reference data —
 * no `toDocument` (the seed writes raw upsert payloads directly).
 */
export function toDomain(document: RoleDocument): RoleView {
  return {
    id: createRoleId(document._id),
    name: document.role_name,
    status: document.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    deletedAt: document.deleted_at === null ? null : fromDate(document.deleted_at),
  };
}

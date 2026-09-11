import type { EntityChange } from '../model/aggregates/EntityChange.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Puerto append-only para `entity_change_log`, gemelo de `AuditLogRepository`.
 * Solo `save`: sin update ni delete, porque un registro de cambios que se
 * puede cambiar no registra nada.
 */
export interface EntityChangeRepository {
  save(change: EntityChange, tx?: Transaction): Promise<void>;
}

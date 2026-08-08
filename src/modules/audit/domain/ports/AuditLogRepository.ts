import type { AuditLog } from '../model/aggregates/AuditLog.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Append-only outbound port for the `AuditLog` aggregate (design D-A8,
 * spec "Append-Only Persistence"). Exposes only `save` — no update, delete,
 * or query methods (YAGNI for this slice — it emits, it does not read).
 */
export interface AuditLogRepository {
  save(auditLog: AuditLog, tx?: Transaction): Promise<void>;
}

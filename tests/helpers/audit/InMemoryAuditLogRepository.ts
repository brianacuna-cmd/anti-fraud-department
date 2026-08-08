import { AuditLog } from '../../../src/modules/audit/domain/model/aggregates/AuditLog.js';
import type { AuditLogRepository } from '../../../src/modules/audit/domain/ports/AuditLogRepository.js';

/**
 * In-memory `AuditLogRepository` fake (design "Testing Strategy: in-memory
 * fakes for ports"). Map-backed, save-only — mirrors `InMemorySessionRepository`.
 */
export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly byId = new Map<string, AuditLog>();

  async save(auditLog: AuditLog): Promise<void> {
    this.byId.set(auditLog.id, auditLog);
  }

  /** Test-only accessor — the real port exposes no read methods (append-only, YAGNI). */
  all(): readonly AuditLog[] {
    return [...this.byId.values()];
  }
}

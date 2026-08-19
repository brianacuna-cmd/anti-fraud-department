import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { CaseStatus } from '../domain/model/value-objects/CaseStatus.js';
import type { CasePriority } from '../domain/model/value-objects/CasePriority.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const EXPORT_READ_ROLES = ['SUPERVISOR', 'ADMIN', 'AUDITOR'] as const;
/** Safety cap so a tenant-wide export cannot exhaust memory. */
export const CASE_EXPORT_MAX_ROWS = 5000;

export interface ExportCasesInput {
  readonly auth: AuthContext;
  readonly status?: readonly CaseStatus[];
  readonly priority?: readonly CasePriority[];
  readonly assignedToId?: string;
  readonly riskScoreMin?: number;
  readonly riskScoreMax?: number;
  readonly tags?: readonly string[];
  readonly dueAfter?: Instant;
  readonly dueBefore?: Instant;
}

export interface ExportCasesResult {
  readonly rows: readonly Case[];
  readonly total: number;
  /** True when `total` exceeded the safety cap and `rows` is truncated. */
  readonly truncated: boolean;
}

export interface ExportCasesDeps {
  readonly cases: CaseRepository;
}

/**
 * GET /cases/export — tenant-scoped, filtered case export for internal audit /
 * ops. Role-gated to SUPERVISOR|ADMIN|AUDITOR. Format-agnostic: yields the
 * filtered domain rows (up to CASE_EXPORT_MAX_ROWS); the HTTP layer renders
 * them to json/xlsx/pdf. Scope: cases (read-only).
 */
export function createExportCasesUseCase(deps: ExportCasesDeps) {
  return async function exportCases(input: ExportCasesInput): Promise<ExportCasesResult> {
    requireRole(input.auth, EXPORT_READ_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const page = await deps.cases.list({
      organizationId,
      status: input.status,
      priority: input.priority,
      assignedToId: input.assignedToId,
      riskScoreMin: input.riskScoreMin,
      riskScoreMax: input.riskScoreMax,
      tags: input.tags,
      dueAfter: input.dueAfter,
      dueBefore: input.dueBefore,
      limit: CASE_EXPORT_MAX_ROWS,
      offset: 0,
    });
    return {
      rows: page.items,
      total: page.total,
      truncated: page.total > page.items.length,
    };
  };
}

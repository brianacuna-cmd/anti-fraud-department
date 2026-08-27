import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { FinturuDirectoryRepository } from '../domain/ports/FinturuDirectoryRepository.js';

export interface EnrichedFinturuCustomer {
  readonly idUser: string;
  readonly idUserBridge?: string | null;
  readonly name?: string | null;
  readonly lastname?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly status?: string | null;
  readonly address?: string | null;
  readonly idCustomer?: string | null;
  readonly wallets: readonly unknown[];
  readonly transfers: readonly unknown[];
  readonly stripe: Record<string, unknown> | null;
  readonly riskScore: number;
  readonly hasOpenCase: boolean;
  readonly existingCaseId?: string | null;
  readonly existingCaseStatus?: string | null;
}

export interface FinturuDirectoryView {
  readonly customers: readonly EnrichedFinturuCustomer[];
  readonly total: number;
  /** Time of the last refresh; `null` if the directory has never been synced. */
  readonly syncedAt: string | null;
}

export interface GetFinturuDirectoryInput {
  readonly auth?: AuthContext;
  readonly organizationId?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string;
}

export interface GetFinturuDirectoryDeps {
  readonly directory: FinturuDirectoryRepository;
  readonly cases: CaseRepository;
  readonly defaultOrganizationId?: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * Reads the directory from the local copy, not from Bridge.
 *
 * Composing it live used to take minutes; against Mongo the query is
 * milliseconds, and it also allows what Bridge's cursor pagination did not:
 * a real total, search over the whole register, and sort by risk.
 * The price is that the data has the age of the last sync, which is
 * returned in `syncedAt` so the UI can show it.
 */
export function createGetFinturuDirectoryUseCase(deps: GetFinturuDirectoryDeps) {
  return async function getFinturuDirectory(
    input: GetFinturuDirectoryInput = {},
  ): Promise<FinturuDirectoryView> {
    const orgId = input.organizationId ?? input.auth?.organizationId ?? deps.defaultOrganizationId ?? '019d7e58aed0777318d11d4d';
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(Math.trunc(input.offset ?? 0) || 0, 0);

    const [page, existingCasesPage] = await Promise.all([
      deps.directory.page({ limit, offset, search: input.search }),
      deps.cases.list({ organizationId: orgId, limit: 5000, offset: 0 }),
    ]);

    const caseByCustomerKey = new Map<string, { id: string; status: string }>();
    for (const c of existingCasesPage.items) {
      if (c.customerId) caseByCustomerKey.set(c.customerId, { id: c.id, status: c.status });
      if (c.bridgeUserId) caseByCustomerKey.set(c.bridgeUserId, { id: c.id, status: c.status });
      if (c.customerEmail) caseByCustomerKey.set(c.customerEmail.toLowerCase().trim(), { id: c.id, status: c.status });
    }

    const customers = page.items.map((entry): EnrichedFinturuCustomer => {
      const email = entry.email ? entry.email.toLowerCase().trim() : '';
      const existingCase =
        caseByCustomerKey.get(entry.idUser) ??
        (entry.idUserBridge ? caseByCustomerKey.get(entry.idUserBridge) : undefined) ??
        (email ? caseByCustomerKey.get(email) : undefined) ??
        null;

      return {
        ...entry,
        hasOpenCase: Boolean(existingCase),
        existingCaseId: existingCase?.id ?? null,
        existingCaseStatus: existingCase?.status ?? null,
      };
    });

    return { customers, total: page.total, syncedAt: page.syncedAt };
  };
}

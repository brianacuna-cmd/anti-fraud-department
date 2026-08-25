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
  /** Momento del último refresco; `null` si el directorio nunca se sincronizó. */
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
 * Lee el directorio de la copia local, no de Bridge.
 *
 * Componerlo en vivo costaba minutos; contra Mongo la consulta es de
 * milisegundos, y además permite lo que la paginación por cursor de Bridge no
 * daba: total real, búsqueda sobre todo el padrón y orden por riesgo.
 * El precio es que los datos tienen la antigüedad del último sync, que se
 * devuelve en `syncedAt` para que la interfaz pueda mostrarla.
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

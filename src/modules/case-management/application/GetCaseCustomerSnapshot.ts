import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type {
  FinturuDirectoryEntry,
  FinturuDirectoryRepository,
} from '../domain/ports/FinturuDirectoryRepository.js';
import type { CustomerDetailReader } from '../domain/ports/CustomerDetailReader.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetCaseCustomerSnapshotInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface CaseCustomerSnapshotView {
  /** `null` cuando el cliente ya no está en el padrón de Finturu. */
  readonly customer: FinturuDirectoryEntry | null;
  /** Antigüedad de la composición que sirve esta foto. */
  readonly composedAt: string | null;
  /**
   * El proveedor devolvió billeteras sin dirección ni red. La ficha lo
   * necesita para decir «no lo sabemos» donde si no diría «no tiene».
   */
  readonly walletsIncomplete: boolean;
}

export interface GetCaseCustomerSnapshotDeps {
  readonly cases: CaseRepository;
  readonly directory: FinturuDirectoryRepository;
  /**
   * Billeteras y movimientos por sus rutas propias. Opcional: sin él la ficha
   * se queda con lo que traiga el padrón, que hoy es nada.
   */
  readonly customerDetail?: CustomerDetailReader;
}

/**
 * Los datos del cliente de un expediente, EN VIVO.
 *
 * Sustituye a `Case.finturuCacheSnapshot`, que era una copia del payload del
 * proveedor guardada en el expediente el día que se abrió y que la ficha leía
 * para pintar movimientos, billeteras y datos crudos. Dejó de guardarse por dos
 * motivos: era una segunda residencia de datos personales, y sobre todo mentía
 * —un expediente de hace seis meses mostraba la situación de hace seis meses
 * con aspecto de actual.
 *
 * Las guardas son las de cualquier lectura del expediente —inquilino, 404 si no
 * existe, 403 si es de otra organización— porque esto no es un dato nuevo: es
 * el cliente del caso que el actor ya podía consultar.
 *
 * Sale del directorio en vivo, así que no añade tráfico contra Bridge: una
 * composición cacheada sirve al listado, a esta ficha y al informe congelado.
 */
export function createGetCaseCustomerSnapshotUseCase(deps: GetCaseCustomerSnapshotDeps) {
  return async function getCaseCustomerSnapshot(
    input: GetCaseCustomerSnapshotInput,
  ): Promise<CaseCustomerSnapshotView> {
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    const kase = await deps.cases.findById(caseId);
    if (kase === null) {
      throw caseNotFound(caseId);
    }
    if (kase.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }

    const [customer, composedAt, detail] = await Promise.all([
      deps.directory.findByCustomer({
        idUser: kase.customerId,
        idUserBridge: kase.bridgeUserId,
        email: kase.customerEmail,
      }),
      deps.directory.lastSyncedAt(),
      deps.customerDetail?.detailFor({ idUserBridge: kase.bridgeUserId }),
    ]);

    if (customer === null) {
      return { customer: null, composedAt, walletsIncomplete: false };
    }

    /*
     * El detalle por cliente MANDA sobre el padrón.
     *
     * No es una preferencia: el padrón compone las billeteras y los
     * movimientos a partir de listados globales cuyos campos de enlace llegan
     * en `null`, así que sus dos listas están vacías para todo el mundo. Las
     * rutas por cliente resuelven el dueño por su cuenta y sí traen las filas.
     * Se prefiere lo que tenga contenido, de modo que el día que los listados
     * globales se arreglen esto siga dando lo mismo.
     */
    const wallets = detail && detail.wallets.length > 0 ? detail.wallets : customer.wallets;
    const transfers = detail && detail.transfers.length > 0 ? detail.transfers : customer.transfers;

    return {
      customer: { ...customer, wallets, transfers },
      composedAt,
      walletsIncomplete: detail?.walletsIncomplete ?? false,
    };
  };
}

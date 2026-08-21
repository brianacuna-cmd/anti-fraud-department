import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { ApprovalRequest } from '../domain/model/aggregates/ApprovalRequest.js';
import type { EnforcementAction } from '../domain/model/aggregates/EnforcementAction.js';
import type { ApprovalRequestRepository } from '../domain/ports/ApprovalRequestRepository.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { OVERSIGHT_READ_ROLES, requireReadRole } from './authorization/policy.js';

/**
 * Una solicitud SIEMPRE viaja con la sancion que la motiva: revisarla a
 * ciegas —sin saber si bloquea una wallet o suspende a un cliente— no es
 * revisar, es firmar.
 */
export interface PendingApproval {
  readonly approvalRequest: ApprovalRequest;
  readonly enforcementAction: EnforcementAction;
  /**
   * `false` cuando quien consulta es quien pidio la medida: la vera en la
   * cola, sabra que esta esperando, y no podra decidirla (cuatro ojos).
   */
  readonly reviewableByCaller: boolean;
}

export interface ListApprovalRequestsInput {
  readonly auth: AuthContext;
  readonly limit: number;
  readonly offset: number;
}

export interface ListApprovalRequestsResult {
  readonly items: readonly PendingApproval[];
  readonly total: number;
}

export interface ListApprovalRequestsDeps {
  readonly enforcementActions: EnforcementActionRepository;
  readonly approvalRequests: ApprovalRequestRepository;
}

/**
 * GET /approval-requests — la cola de doble firma (ENF-002).
 *
 * Sin esto el control de cuatro ojos no tenia donde ejercerse: existian las
 * solicitudes y existia la ruta para decidir UNA por su id, pero nada que
 * respondiera "que hay esperando". Un control que nadie puede ver es un
 * control que no se ejerce.
 *
 * Se consulta partiendo de `enforcement_actions` y no de `approval_requests`
 * porque la fila de aprobacion NO lleva `organization_id` (design: el ambito
 * lo hereda de la sancion), asi que es la sancion la que aporta la guarda de
 * inquilino. De paso, el orden y la paginacion salen ya resueltos del
 * repositorio de sanciones.
 */
export function createListApprovalRequestsUseCase(deps: ListApprovalRequestsDeps) {
  return async function listApprovalRequests(
    input: ListApprovalRequestsInput,
  ): Promise<ListApprovalRequestsResult> {
    requireReadRole(input.auth, OVERSIGHT_READ_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const pendingActions = await deps.enforcementActions.list({
      organizationId,
      status: 'PENDING',
      limit: input.limit,
      offset: input.offset,
    });

    const items: PendingApproval[] = [];
    for (const enforcementAction of pendingActions.items) {
      const approvalRequest = await deps.approvalRequests.findByEnforcementActionId(
        enforcementAction.id,
      );
      // Una sancion PENDING sin solicitud es una anterior a ENF-002: la cola
      // la omite en vez de inventarle una fila, y sigue siendo aprobable por
      // la ruta directa, que crea la solicitud al vuelo.
      if (approvalRequest === null || approvalRequest.status !== 'PENDING') {
        continue;
      }
      items.push({
        approvalRequest,
        enforcementAction,
        reviewableByCaller: approvalRequest.requesterId !== input.auth.userId,
      });
    }

    return { items, total: pendingActions.total };
  };
}

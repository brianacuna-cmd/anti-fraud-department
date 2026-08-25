import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { AnalystDecision } from '../domain/model/aggregates/AnalystDecision.js';
import type { AnalystDecisionRepository } from '../domain/ports/AnalystDecisionRepository.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListCaseDecisionsInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface ListCaseDecisionsDeps {
  readonly cases: CaseRepository;
  readonly analystDecisions: AnalystDecisionRepository;
}

/**
 * GET /cases/:caseId/decisions — los dictamenes ya emitidos sobre un caso.
 *
 * Faltaba, y se notaba: la ficha abria todo expediente diciendo "Sin
 * dictaminar" porque no tenia de donde leerlos, y solo mostraba el dictamen
 * que se registrara en esa misma sesion. Un caso ya resuelto se veia como uno
 * recien abierto.
 *
 * Lectura pura, sin guarda de rol: quien puede ver el caso puede ver que se
 * concluyo sobre el — negarselo al auditor seria negarle justamente lo que
 * viene a auditar. Las mismas puertas que `GetCase`: inquilino y borrado
 * logico.
 */
export function createListCaseDecisionsUseCase(deps: ListCaseDecisionsDeps) {
  return async function listCaseDecisions(
    input: ListCaseDecisionsInput,
  ): Promise<readonly AnalystDecision[]> {
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    const kase = await deps.cases.findById(caseId);
    if (kase === null || kase.deletedAt !== null) {
      throw caseNotFound(caseId);
    }
    if (kase.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }

    return deps.analystDecisions.findByCaseId(caseId);
  };
}

import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import type { EntityNetworkGraph, EntityRef } from '../domain/services/EntityNetworkGraph.js';
import { EntityNetworkGraphBuilder } from '../domain/services/EntityNetworkGraph.js';
import { entityNodeTypeForSubject } from '../domain/model/value-objects/EntityNodeType.js';
import { createInvestigationId } from '../domain/model/value-objects/InvestigationId.js';
import { investigationNotFound, forbiddenCrossTenant, invariantViolation } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

/** Rondas de expansión por defecto: la entidad, quien la toca, y quien toca a esos. */
export const DEFAULT_GRAPH_DEPTH = 3;

/**
 * Techo duro de profundidad. Cada ronda multiplica el frente, así que dejar
 * que el cliente pida 50 es regalarle un modo de tumbar el proceso desde una
 * query string.
 */
export const MAX_GRAPH_DEPTH = 5;

/**
 * Expedientes que se traen por ronda. Junto con `MAX_GRAPH_NODES` acota el
 * coste: sin esto, un identificador compartido por medio inquilino convierte
 * la ronda siguiente en un escaneo de la colección entera.
 */
export const CASES_PER_ROUND = 200;

export interface BuildEntityNetworkGraphInput {
  readonly auth: AuthContext;
  readonly investigationId: string;
  /** Rondas de expansión. Por defecto `DEFAULT_GRAPH_DEPTH`; tope `MAX_GRAPH_DEPTH`. */
  readonly maxDepth?: number;
}

export interface BuildEntityNetworkGraphDeps {
  readonly cases: CaseRepository;
  readonly investigations: InvestigationRepository;
}

/**
 * INV-013 — Entity Network Graph Builder.
 *
 * Construye la red de una investigación profunda: parte del sujeto
 * (`subjectType`/`subjectId`) y se expande en anchura por los identificadores
 * que los expedientes comparten, alternando identificador → expedientes que lo
 * citan → identificadores nuevos de esos expedientes.
 *
 * Las guardas son las mismas que `GetInvestigation` —tenant, 404 si no existe,
 * 403 si es de otra organización— porque el grafo no es un dato nuevo sino una
 * vista de expedientes que el actor ya podía leer. Lo que sí se respeta es el
 * aislamiento: la expansión pasa siempre `organizationId`, así que una red que
 * cruce inquilinos se corta en el borde. Es deliberado, aunque la wallet sea
 * literalmente la misma: la alternativa filtra a un tenant la existencia de
 * expedientes de otro.
 */
export function createBuildEntityNetworkGraphUseCase(deps: BuildEntityNetworkGraphDeps) {
  return async function buildEntityNetworkGraph(
    input: BuildEntityNetworkGraphInput,
  ): Promise<EntityNetworkGraph> {
    const organizationId = requireTenantContext(input.auth);
    const investigationId = createInvestigationId(input.investigationId);
    const maxDepth = resolveDepth(input.maxDepth);

    const investigation = await deps.investigations.findById(investigationId);
    if (investigation === null) {
      throw investigationNotFound(investigationId);
    }
    if (investigation.organizationId !== organizationId) {
      throw forbiddenCrossTenant('investigation does not belong to the actor organization');
    }

    const builder = new EntityNetworkGraphBuilder(
      {
        type: entityNodeTypeForSubject(investigation.subjectType),
        value: investigation.subjectId,
      },
      maxDepth,
    );

    let frontier: readonly EntityRef[] = builder.frontier();
    for (let round = 1; round <= maxDepth; round += 1) {
      const cases = await deps.cases.findByEntityIdentifiers({
        organizationId,
        refs: frontier,
        limit: CASES_PER_ROUND,
      });
      frontier = builder.absorb(cases, round);
      // Frente vacío = la red se agotó. Parar aquí deja `truncated` en false,
      // que es la diferencia entre "esto es toda la red" y "esto es lo que
      // cupo": sin el corte, el bucle gastaría rondas y el resultado mentiría.
      if (frontier.length === 0) {
        break;
      }
    }

    return builder.build(frontier);
  };
}

function resolveDepth(requested: number | undefined): number {
  if (requested === undefined) {
    return DEFAULT_GRAPH_DEPTH;
  }
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_GRAPH_DEPTH) {
    throw invariantViolation(`maxDepth must be an integer between 1 and ${MAX_GRAPH_DEPTH}`, {
      maxDepth: requested,
    });
  }
  return requested;
}

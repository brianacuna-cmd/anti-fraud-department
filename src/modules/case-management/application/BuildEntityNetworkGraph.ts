import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import type { EntityNetworkGraph, EntityRef } from '../domain/services/EntityNetworkGraph.js';
import { EntityNetworkGraphBuilder } from '../domain/services/EntityNetworkGraph.js';
import { entityNodeTypeForSubject } from '../domain/model/value-objects/EntityNodeType.js';
import { createInvestigationId } from '../domain/model/value-objects/InvestigationId.js';
import { investigationNotFound, forbiddenCrossTenant, invariantViolation } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

/** Default expansion rounds: the entity, who touches it, and who touches those. */
export const DEFAULT_GRAPH_DEPTH = 3;

/**
 * Hard depth ceiling. Each round multiplies the frontier, so letting the
 * client ask for 50 would gift them a way to take the process down from a
 * query string.
 */
export const MAX_GRAPH_DEPTH = 5;

/**
 * Cases fetched per round. Together with `MAX_GRAPH_NODES` it bounds the
 * cost: without this, an identifier shared by half the tenant turns the
 * next round into a scan of the entire collection.
 */
export const CASES_PER_ROUND = 200;

export interface BuildEntityNetworkGraphInput {
  readonly auth: AuthContext;
  readonly investigationId: string;
  /** Expansion rounds. Defaults to `DEFAULT_GRAPH_DEPTH`; cap is `MAX_GRAPH_DEPTH`. */
  readonly maxDepth?: number;
}

export interface BuildEntityNetworkGraphDeps {
  readonly cases: CaseRepository;
  readonly investigations: InvestigationRepository;
}

/**
 * INV-013 — Entity Network Graph Builder.
 *
 * Builds the network of a deep investigation: starts from the subject
 * (`subjectType`/`subjectId`) and expands breadth-first through the
 * identifiers that cases share, alternating identifier → cases that cite
 * it → new identifiers from those cases.
 *
 * The gates are the same as `GetInvestigation` —tenant, 404 if it does not
 * exist, 403 if it belongs to another organization— because the graph is not
 * new data but a view of cases the actor could already read. What is
 * respected is isolation: expansion always passes `organizationId`, so a
 * network that would cross tenants is cut at the edge. That is deliberate,
 * even if the wallet is literally the same: the alternative would leak to
 * one tenant the existence of another tenant's cases.
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
      // Empty frontier = the network is exhausted. Stopping here leaves
      // `truncated` as false, which is the difference between "this is the
      // whole network" and "this is what fit": without the cut, the loop
      // would spend rounds and the result would lie.
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

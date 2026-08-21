import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { AnalystDecisionRepository } from '../domain/ports/AnalystDecisionRepository.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import type { CasePriority } from '../domain/model/value-objects/CasePriority.js';
import type { CaseStatus } from '../domain/model/value-objects/CaseStatus.js';
import type { EntityNodeType } from '../domain/model/value-objects/EntityNodeType.js';
import type { EntityNetworkGraph, NetworkNode } from '../domain/services/EntityNetworkGraph.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { createInvestigationId } from '../domain/model/value-objects/InvestigationId.js';
import { investigationNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import type { createBuildEntityNetworkGraphUseCase } from './BuildEntityNetworkGraph.js';

export interface InvestigationSummaryCase {
  readonly caseId: string;
  readonly status: CaseStatus;
  readonly priority: CasePriority;
  readonly riskScore: number;
  readonly customerId: string;
  readonly createdAt: Instant;
  /** Profundidad a la que la red alcanzó este expediente. 1 = lo toca la raíz. */
  readonly depth: number;
  readonly decisions: readonly {
    readonly id: string;
    readonly decision: string;
    readonly confidence: number;
    readonly createdAt: Instant;
  }[];
  readonly enforcementActions: readonly {
    readonly id: string;
    readonly actionType: string;
    readonly status: string;
    readonly targetType: string;
    readonly targetId: string;
  }[];
}

export interface InvestigationSummary {
  readonly investigation: {
    readonly id: string;
    readonly subjectType: string;
    readonly subjectId: string;
    readonly status: string;
    readonly findings: string | null;
    readonly findingsData: Record<string, unknown> | null;
    readonly explorationDepth: number | null;
    readonly openedBy: string;
    readonly createdAt: Instant;
    readonly closedAt: Instant | null;
  };
  readonly network: {
    readonly rootId: string;
    readonly totalCases: number;
    readonly totalEntities: number;
    readonly entitiesByType: Readonly<Record<EntityNodeType, number>>;
    readonly depthReached: number;
    /** `true` = la red mostrada es un recorte, no la red completa. */
    readonly truncated: boolean;
  };
  readonly totals: {
    readonly casesByStatus: Readonly<Record<string, number>>;
    readonly confirmedFraudCases: number;
    readonly enforcementActions: number;
    readonly maxRiskScore: number;
  };
  readonly cases: readonly InvestigationSummaryCase[];
  readonly generatedAt: Instant;
}

export interface ExportInvestigationSummaryInput {
  readonly auth: AuthContext;
  readonly investigationId: string;
  readonly maxDepth?: number;
}

export interface ExportInvestigationSummaryDeps {
  readonly cases: CaseRepository;
  readonly investigations: InvestigationRepository;
  readonly decisions: AnalystDecisionRepository;
  readonly enforcementActions: EnforcementActionRepository;
  readonly buildEntityNetworkGraph: ReturnType<typeof createBuildEntityNetworkGraphUseCase>;
  readonly clock: Clock;
}

/**
 * INV-014 — informe ejecutivo consolidado de una investigación profunda.
 *
 * GET /investigations/:investigationId/summary
 *
 * Toma la red que arma INV-013 y la convierte en lo que un comité de riesgo o
 * un regulador pide de verdad: cuántos expedientes toca la entidad, en qué
 * estado están, cuántos acabaron en fraude confirmado y qué medidas se
 * aplicaron. El grafo responde "quién está conectado"; esto responde "cuánto
 * daño hay y qué se hizo".
 *
 * Se genera al vuelo y no se congela en `case_reports`. Un informe congelado
 * es la foto de UN expediente cerrado y por eso tiene sentido inmovilizarlo;
 * una investigación abierta cambia con cada caso que entra en la red, así que
 * guardar una copia solo produciría informes que envejecen en silencio. El
 * congelado sigue siendo `GenerateCaseReport` (INV-007), por caso.
 *
 * `network.truncated` se propaga tal cual desde el grafo: si la red venía
 * recortada, los totales de este informe son un mínimo, no un total, y quien
 * lo lea tiene que poder saberlo.
 */
export function createExportInvestigationSummaryUseCase(deps: ExportInvestigationSummaryDeps) {
  return async function exportInvestigationSummary(
    input: ExportInvestigationSummaryInput,
  ): Promise<InvestigationSummary> {
    const organizationId = requireTenantContext(input.auth);
    const investigationId = createInvestigationId(input.investigationId);

    const investigation = await deps.investigations.findById(investigationId);
    if (investigation === null) {
      throw investigationNotFound(investigationId);
    }
    if (investigation.organizationId !== organizationId) {
      throw forbiddenCrossTenant('investigation does not belong to the actor organization');
    }

    const graph = await deps.buildEntityNetworkGraph({
      auth: input.auth,
      investigationId: input.investigationId,
      ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
    });

    const caseNodes = graph.nodes.filter(isCaseNode);
    const summaries = await Promise.all(
      caseNodes.map(async (node) => buildCaseSummary(deps, node.caseId, node.depth)),
    );
    const present = summaries.filter((summary): summary is InvestigationSummaryCase => summary !== null);

    return {
      investigation: {
        id: investigation.id,
        subjectType: investigation.subjectType,
        subjectId: investigation.subjectId,
        status: investigation.status,
        findings: investigation.findings,
        findingsData: investigation.findingsData,
        explorationDepth: investigation.explorationDepth,
        openedBy: investigation.openedBy,
        createdAt: investigation.createdAt,
        closedAt: investigation.closedAt,
      },
      network: buildNetworkSection(graph, present.length),
      totals: buildTotals(present),
      cases: present.sort((a, b) => b.riskScore - a.riskScore),
      generatedAt: deps.clock.now(),
    };
  };
}

function isCaseNode(node: NetworkNode): node is Extract<NetworkNode, { kind: 'CASE' }> {
  return node.kind === 'CASE';
}

async function buildCaseSummary(
  deps: ExportInvestigationSummaryDeps,
  caseId: string,
  depth: number,
): Promise<InvestigationSummaryCase | null> {
  const id = createCaseId(caseId);
  const kase = await deps.cases.findById(id);
  // El grafo se armó con una foto anterior; si el expediente desaparecio entre
  // medias, se omite en vez de reventar el informe entero.
  if (kase === null) {
    return null;
  }

  const [decisions, actions] = await Promise.all([
    deps.decisions.findByCaseId(id),
    deps.enforcementActions.findByCaseId(id),
  ]);

  return {
    caseId: kase.id,
    status: kase.status,
    priority: kase.priority,
    riskScore: kase.riskScore,
    customerId: kase.customerId,
    createdAt: kase.createdAt,
    depth,
    decisions: decisions.map((decision) => ({
      id: decision.id,
      decision: decision.decision,
      confidence: decision.confidence,
      createdAt: decision.createdAt,
    })),
    enforcementActions: actions.map((action) => ({
      id: action.id,
      actionType: action.actionType,
      status: action.status,
      targetType: action.targetType,
      targetId: action.targetId,
    })),
  };
}

function buildNetworkSection(
  graph: EntityNetworkGraph,
  totalCases: number,
): InvestigationSummary['network'] {
  const entitiesByType: Record<EntityNodeType, number> = {
    CUSTOMER: 0,
    EMAIL: 0,
    WALLET: 0,
    BRIDGE_USER: 0,
    STRIPE_CUSTOMER: 0,
  };
  const entityNodes = graph.nodes.filter((node) => node.kind === 'ENTITY');
  for (const node of entityNodes) {
    entitiesByType[node.type] += 1;
  }

  return {
    rootId: graph.rootId,
    totalCases,
    totalEntities: entityNodes.length,
    entitiesByType,
    depthReached: graph.depthReached,
    truncated: graph.truncated,
  };
}

function buildTotals(cases: readonly InvestigationSummaryCase[]): InvestigationSummary['totals'] {
  const casesByStatus: Record<string, number> = {};
  for (const kase of cases) {
    casesByStatus[kase.status] = (casesByStatus[kase.status] ?? 0) + 1;
  }

  const confirmedFraudCases = cases.filter((kase) =>
    kase.decisions.some((decision) => decision.decision === 'FRAUD_CONFIRMED'),
  ).length;
  const enforcementActions = cases.reduce((total, kase) => total + kase.enforcementActions.length, 0);
  const maxRiskScore = cases.reduce((max, kase) => Math.max(max, kase.riskScore), 0);

  return { casesByStatus, confirmedFraudCases, enforcementActions, maxRiskScore };
}

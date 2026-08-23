import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { AnalystDecisionRepository } from '../domain/ports/AnalystDecisionRepository.js';
import type { CaseNoteRepository } from '../domain/ports/CaseNoteRepository.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import type { EvidenceRepository } from '../domain/ports/EvidenceRepository.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import type { CaseId } from '../domain/model/value-objects/CaseId.js';
import type { CasePriority } from '../domain/model/value-objects/CasePriority.js';
import type { CaseStatus } from '../domain/model/value-objects/CaseStatus.js';
import type { EntityNodeType } from '../domain/model/value-objects/EntityNodeType.js';
import type { EntityNetworkGraph, NetworkNode } from '../domain/services/EntityNetworkGraph.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { createInvestigationId } from '../domain/model/value-objects/InvestigationId.js';
import { investigationNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import type { createBuildEntityNetworkGraphUseCase } from './BuildEntityNetworkGraph.js';

/**
 * Cómo entró el expediente en el informe.
 *
 * `PRIMARY` y `LINKED` son afirmaciones humanas: alguien dijo "este caso
 * pertenece a esta investigación". `NETWORK` es inferencia de la máquina a
 * partir de un identificador compartido. Quien lea el informe necesita poder
 * distinguirlos: un vínculo declarado sostiene una acusación, uno inferido
 * sostiene una línea de trabajo.
 */
export type InvestigationCaseOrigin = 'PRIMARY' | 'LINKED' | 'NETWORK';

export interface InvestigationSummaryNote {
  readonly id: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: Instant;
}

export interface InvestigationSummaryEvidence {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface InvestigationSummaryCase {
  readonly caseId: string;
  readonly origin: InvestigationCaseOrigin;
  readonly status: CaseStatus;
  readonly priority: CasePriority;
  readonly riskScore: number;
  readonly customerId: string;
  readonly createdAt: Instant;
  /**
   * Profundidad a la que la red alcanzó este expediente. 1 = lo toca la raíz.
   * `0` en los vinculados a mano: no los descubrió la expansión.
   */
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
  /** Solo con `includeCaseDetail`. Excluye lo borrado en blando (INV-011). */
  readonly notes?: readonly InvestigationSummaryNote[];
  /** Solo con `includeCaseDetail`. Excluye lo borrado en blando (INV-011). */
  readonly evidence?: readonly InvestigationSummaryEvidence[];
}

export interface InvestigationSummary {
  readonly investigation: {
    readonly id: string;
    /** Expediente raíz. Puede no aparecer en `cases` si se borró entre medias. */
    readonly caseId: string;
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
    /** Expedientes que descubrió la expansión. No incluye los vinculados a mano. */
    readonly totalCases: number;
    readonly totalEntities: number;
    readonly entitiesByType: Readonly<Record<EntityNodeType, number>>;
    readonly depthReached: number;
    /** `true` = la red mostrada es un recorte, no la red completa. */
    readonly truncated: boolean;
  };
  readonly totals: {
    /** Todos los expedientes del informe: vinculados a mano más los de la red. */
    readonly totalCases: number;
    readonly linkedCases: number;
    readonly networkCases: number;
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
  /**
   * Añade notas y evidencia de cada expediente. Lo pide `/export`, que compone
   * el documento probatorio; `/summary` lo omite porque alimenta un panel y la
   * red puede llegar a `MAX_GRAPH_NODES` expedientes — arrastrar el cuerpo de
   * cada nota convertiría una vista en una descarga.
   */
  readonly includeCaseDetail?: boolean;
}

export interface ExportInvestigationSummaryDeps {
  readonly cases: CaseRepository;
  readonly investigations: InvestigationRepository;
  readonly decisions: AnalystDecisionRepository;
  readonly enforcementActions: EnforcementActionRepository;
  readonly notes: CaseNoteRepository;
  readonly evidence: EvidenceRepository;
  readonly buildEntityNetworkGraph: ReturnType<typeof createBuildEntityNetworkGraphUseCase>;
  readonly clock: Clock;
}

/**
 * INV-014 — informe ejecutivo consolidado de una investigación profunda.
 *
 * Sirve dos rutas con el mismo cuerpo:
 *
 *   GET /investigations/:id/summary  — vista viva, sin notas ni evidencia
 *   GET /investigations/:id/export   — vía `ExportInvestigation`, congelado
 *
 * DE DÓNDE SALEN LOS EXPEDIENTES
 *
 * De dos sitios, y hacen falta los dos. La expansión de INV-013 descubre lo
 * que nadie declaró —el caso que comparte wallet con el sujeto y que ningún
 * analista relacionó—, pero solo ve conexiones que existen como identificador
 * compartido. Un vínculo hecho a mano puede no tener ninguno: dos expedientes
 * que un investigador ató por el modus operandi no comparten campo alguno, y
 * la expansión jamás los va a juntar.
 *
 * Por eso el informe es la unión: `caseId` + `linkedCaseIds` siempre, más lo
 * que aporte la red. Quedarse solo con la red pierde el trabajo humano;
 * quedarse solo con los vínculos convierte el informe en una lista que ya
 * estaba escrita. Cada expediente lleva su `origin` para que quien lo lea sepa
 * cuál de las dos cosas está mirando.
 *
 * `network.truncated` se propaga tal cual desde el grafo: si la red venía
 * recortada, los totales son un mínimo, no un total, y quien lo lea tiene que
 * poder saberlo.
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

    const requests = collectCaseRequests(investigation.caseId, investigation.linkedCaseIds, graph);
    const detail = input.includeCaseDetail === true;
    const summaries = await Promise.all(
      requests.map(async (request) => buildCaseSummary(deps, request, detail)),
    );
    const present = summaries.filter(
      (summary): summary is InvestigationSummaryCase => summary !== null,
    );

    return {
      investigation: {
        id: investigation.id,
        caseId: investigation.caseId,
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
      network: buildNetworkSection(graph),
      totals: buildTotals(present),
      cases: [...present].sort(byOriginThenRisk),
      generatedAt: deps.clock.now(),
    };
  };
}

interface CaseRequest {
  readonly caseId: string;
  readonly origin: InvestigationCaseOrigin;
  readonly depth: number;
}

/**
 * La unión de vínculos declarados y red inferida, sin repetir.
 *
 * El orden importa: lo declarado se resuelve primero, así que un expediente
 * que está a la vez vinculado a mano y descubierto por la red conserva el
 * origen humano, que es el que más dice.
 */
function collectCaseRequests(
  primary: CaseId,
  linked: readonly CaseId[],
  graph: EntityNetworkGraph,
): readonly CaseRequest[] {
  const seen = new Set<string>();
  const requests: CaseRequest[] = [];

  const declared: readonly CaseRequest[] = [
    { caseId: primary as string, origin: 'PRIMARY', depth: 0 },
    ...linked.map((id): CaseRequest => ({ caseId: id as string, origin: 'LINKED', depth: 0 })),
  ];
  const discovered: readonly CaseRequest[] = graph.nodes
    .filter(isCaseNode)
    .map((node) => ({ caseId: node.caseId, origin: 'NETWORK' as const, depth: node.depth }));

  for (const request of [...declared, ...discovered]) {
    pushUnseen(requests, seen, request);
  }
  return requests;
}

function pushUnseen(into: CaseRequest[], seen: Set<string>, request: CaseRequest): void {
  if (seen.has(request.caseId)) {
    return;
  }
  seen.add(request.caseId);
  into.push(request);
}

const ORIGIN_RANK: Readonly<Record<InvestigationCaseOrigin, number>> = {
  PRIMARY: 0,
  LINKED: 1,
  NETWORK: 2,
};

/** El caso raíz arriba, después lo declarado, y dentro de cada grupo el riesgo manda. */
function byOriginThenRisk(a: InvestigationSummaryCase, b: InvestigationSummaryCase): number {
  const rank = ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
  return rank === 0 ? b.riskScore - a.riskScore : rank;
}

function isCaseNode(node: NetworkNode): node is Extract<NetworkNode, { kind: 'CASE' }> {
  return node.kind === 'CASE';
}

async function buildCaseSummary(
  deps: ExportInvestigationSummaryDeps,
  request: CaseRequest,
  detail: boolean,
): Promise<InvestigationSummaryCase | null> {
  const id = createCaseId(request.caseId);
  const kase = await deps.cases.findById(id);
  // El grafo se armó con una foto anterior; si el expediente desaparecio entre
  // medias, se omite en vez de reventar el informe entero.
  if (kase === null) {
    return null;
  }

  const [decisions, actions, notes, evidence] = await Promise.all([
    deps.decisions.findByCaseId(id),
    deps.enforcementActions.findByCaseId(id),
    detail ? deps.notes.listByCaseId(id) : Promise.resolve(null),
    detail ? deps.evidence.listByCaseId(id) : Promise.resolve(null),
  ]);

  return {
    caseId: kase.id,
    origin: request.origin,
    status: kase.status,
    priority: kase.priority,
    riskScore: kase.riskScore,
    customerId: kase.customerId,
    createdAt: kase.createdAt,
    depth: request.depth,
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
    ...(notes === null
      ? {}
      : {
          notes: notes.map((note) => ({
            id: note.id,
            authorId: note.authorId,
            body: note.body,
            createdAt: note.createdAt,
          })),
        }),
    ...(evidence === null
      ? {}
      : {
          evidence: evidence.map((item) => ({
            id: item.id,
            filename: item.filename,
            contentType: item.contentType,
            byteSize: item.byteSize,
            sha256: item.sha256,
          })),
        }),
  };
}

function buildNetworkSection(graph: EntityNetworkGraph): InvestigationSummary['network'] {
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
    totalCases: graph.nodes.filter(isCaseNode).length,
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
  const enforcementActions = cases.reduce(
    (total, kase) => total + kase.enforcementActions.length,
    0,
  );
  const maxRiskScore = cases.reduce((max, kase) => Math.max(max, kase.riskScore), 0);
  const networkCases = cases.filter((kase) => kase.origin === 'NETWORK').length;

  return {
    totalCases: cases.length,
    linkedCases: cases.length - networkCases,
    networkCases,
    casesByStatus,
    confirmedFraudCases,
    enforcementActions,
    maxRiskScore,
  };
}

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
 * How the case entered the report.
 *
 * `PRIMARY` and `LINKED` are human assertions: someone said "this case
 * belongs to this investigation". `NETWORK` is machine inference from a
 * shared identifier. Whoever reads the report needs to tell them apart: a
 * declared link supports an accusation; an inferred one supports a line of
 * inquiry.
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
   * Depth at which the network reached this case. 1 = the root touches it.
   * `0` on manually linked cases: the expansion did not discover them.
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
  /** Only with `includeCaseDetail`. Excludes soft-deleted items (INV-011). */
  readonly notes?: readonly InvestigationSummaryNote[];
  /** Only with `includeCaseDetail`. Excludes soft-deleted items (INV-011). */
  readonly evidence?: readonly InvestigationSummaryEvidence[];
}

export interface InvestigationSummary {
  readonly investigation: {
    readonly id: string;
    /** Root case. May be missing from `cases` if it was deleted in the meantime. */
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
    /** Cases the expansion discovered. Does not include manually linked ones. */
    readonly totalCases: number;
    readonly totalEntities: number;
    readonly entitiesByType: Readonly<Record<EntityNodeType, number>>;
    readonly depthReached: number;
    /** `true` = the shown network is a slice, not the full network. */
    readonly truncated: boolean;
  };
  readonly totals: {
    /** Every case in the report: manually linked plus those from the network. */
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
   * Adds notes and evidence for each case. `/export` requests this to compose
   * the evidentiary document; `/summary` omits it because it feeds a dashboard
   * and the network can reach `MAX_GRAPH_NODES` cases — dragging every note
   * body along would turn a view into a download.
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
 * INV-014 — consolidated executive report for a deep investigation.
 *
 * Serves two routes with the same body:
 *
 *   GET /investigations/:id/summary  — live view, without notes or evidence
 *   GET /investigations/:id/export   — via `ExportInvestigation`, frozen
 *
 * WHERE THE CASES COME FROM
 *
 * From two places, and both are needed. INV-013 expansion discovers what
 * nobody declared — the case that shares a wallet with the subject and that
 * no analyst related — but it only sees connections that exist as a shared
 * identifier. A hand-made link may have none: two cases an investigator
 * tied together by modus operandi share no field, and expansion will never
 * join them.
 *
 * That is why the report is the union: `caseId` + `linkedCaseIds` always,
 * plus whatever the network contributes. Staying with the network alone
 * loses the human work; staying with the links alone turns the report into
 * a list that was already written. Each case carries its `origin` so the
 * reader knows which of the two they are looking at.
 *
 * `network.truncated` is propagated as-is from the graph: if the network
 * came truncated, the totals are a floor, not a total, and the reader has
 * to be able to tell.
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
 * The union of declared links and inferred network, without duplicates.
 *
 * Order matters: declared items are resolved first, so a case that is both
 * manually linked and discovered by the network keeps the human origin,
 * which is the one that says more.
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

/** Root case first, then declared ones, and within each group risk leads. */
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
  // The graph was built from an earlier snapshot; if the case disappeared in
  // the meantime, omit it instead of blowing up the whole report.
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

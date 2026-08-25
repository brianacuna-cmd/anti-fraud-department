import type { Case } from '../model/aggregates/Case.js';
import type { CasePriority } from '../model/value-objects/CasePriority.js';
import type { CaseStatus } from '../model/value-objects/CaseStatus.js';
import type { EntityNodeType, EntityRef } from '../model/value-objects/EntityNodeType.js';
import { entityNodeKey, normalizeEntityValue } from '../model/value-objects/EntityNodeType.js';
import { invariantViolation } from '../errors/CaseManagementError.js';

export type { EntityRef };

export type NetworkNode =
  | {
      readonly kind: 'ENTITY';
      readonly id: string;
      readonly type: EntityNodeType;
      readonly value: string;
      readonly depth: number;
    }
  | {
      readonly kind: 'CASE';
      readonly id: string;
      readonly caseId: string;
      readonly status: CaseStatus;
      readonly priority: CasePriority;
      readonly riskScore: number;
      readonly depth: number;
    };

/**
 * Edge `case → identifier`. The graph is bipartite on purpose: we do not
 * emit case→case edges.
 *
 * Saying "these two cases are connected" and stopping there is exactly the
 * part the analyst cannot audit, and in a fraud case that is not enough:
 * what supports an accusation is *why* they are connected. Leaving the
 * identifier as an intermediate node, the path reads itself — case A →
 * wallet 0xabc → case B — and the hop keeps its proof attached. Rebuilding
 * the case-to-case union from this is trivial for whoever wants it;
 * recovering the reason from a direct edge is impossible.
 */
export interface NetworkEdge {
  /** CASE node id. */
  readonly from: string;
  /** ENTITY node id. */
  readonly to: string;
  /** Which identifier connects them, so the edge can be drawn and filtered. */
  readonly type: EntityNodeType;
}

export interface EntityNetworkGraph {
  /** Node from which expansion started. */
  readonly rootId: string;
  readonly nodes: readonly NetworkNode[];
  readonly edges: readonly NetworkEdge[];
  /** Expansion rounds actually walked (`profundidad_explorada`). */
  readonly depthReached: number;
  /**
   * `true` when expansion stopped because it hit `maxDepth` or the node
   * ceiling and identifiers were still left unvisited — i.e. the graph is
   * NOT the full network. Propagated to JSON so nobody reads a truncated
   * graph as if it were exhaustive.
   */
  readonly truncated: boolean;
}

/**
 * Identifiers a case contributes to the network.
 *
 * They come from fields already normalized by ingestion (`IngestFinturuCase`
 * extracts `idUserBridge`, `walletBridge`, `idCustomer`… from the tangle of
 * shapes Finturu sends) and not from the raw `finturuCacheSnapshot`. The
 * snapshot is a frozen `Record<string, unknown>` whose keys change by
 * provider and date; digging through it here would duplicate that parse in
 * a second place that would drift from the first.
 *
 * Empty values are dropped: a `customerEmail` of `''` connects nobody, but
 * as a node it would group every case without an email under one point.
 */
export function entityIdentifiersOf(kase: Case): readonly EntityRef[] {
  const candidates: readonly (readonly [EntityNodeType, string | null])[] = [
    ['CUSTOMER', kase.customerId],
    ['EMAIL', kase.customerEmail],
    ['WALLET', kase.bridgeWallet],
    ['BRIDGE_USER', kase.bridgeUserId],
    ['STRIPE_CUSTOMER', kase.stripeCustomerId],
  ];

  return candidates
    .filter((entry): entry is readonly [EntityNodeType, string] => entry[1] !== null)
    .map(([type, raw]) => ({ type, value: normalizeEntityValue(type, raw) }))
    .filter((ref) => ref.value !== '');
}

/** Node ceiling per graph. See `EntityNetworkGraphBuilder`. */
export const MAX_GRAPH_NODES = 500;

/**
 * Accumulator for breadth-first exploration.
 *
 * The walk is bipartite and alternates: identifiers on the frontier → the
 * cases that cite them → the *new* identifiers of those cases, which form
 * the next frontier. A "round" is that full cycle, and that is what
 * `depthReached` counts.
 *
 * I/O lives outside: the use case queries the repository and feeds cases
 * into `absorb`, which returns the next frontier. That way all graph logic
 * — deduplication, depth, cutoff — is tested without Mongo.
 *
 * The `MAX_GRAPH_NODES` ceiling is not an optimization: in a tenant with a
 * large network, an identifier shared by thousands of cases (a corporate
 * domain email, an exchange wallet) blows the expansion up on the next
 * round. We would rather return a truncated graph marked as such than
 * take the request down.
 *
 * Walks use `every` instead of `for` + `break` because repo lint forbids
 * nested blocks (`max-depth: 1`): returning `false` from the callback is
 * how we cut off here.
 */
export class EntityNetworkGraphBuilder {
  private readonly nodes = new Map<string, NetworkNode>();
  private readonly edges: NetworkEdge[] = [];
  private readonly seenEdges = new Set<string>();
  private readonly visitedEntities = new Set<string>();
  private readonly rootValue: string;
  private depthReached = 0;
  private truncated = false;

  constructor(
    private readonly root: EntityRef,
    private readonly maxDepth: number,
  ) {
    assertPositiveDepth(maxDepth);
    this.rootValue = normalizeEntityValue(root.type, root.value);
    assertNonEmptyRoot(root.type, this.rootValue);

    const rootId = entityNodeKey(root.type, this.rootValue);
    this.nodes.set(rootId, {
      kind: 'ENTITY',
      id: rootId,
      type: root.type,
      value: this.rootValue,
      depth: 0,
    });
    this.visitedEntities.add(rootId);
  }

  /** The initial frontier: only the root. */
  frontier(): readonly EntityRef[] {
    return [{ type: this.root.type, value: this.rootValue }];
  }

  /**
   * Absorbs the cases that cite the current frontier and returns the next
   * frontier: identifiers that have not been seen yet.
   *
   * Returning empty means the network is exhausted and the use case can
   * stop before reaching `maxDepth` — the result is then the full network,
   * not a slice, and `truncated` stays `false`.
   */
  absorb(cases: readonly Case[], round: number): readonly EntityRef[] {
    assertRoundWithin(round, this.maxDepth);
    this.depthReached = Math.max(this.depthReached, round);

    const next: EntityRef[] = [];
    cases.every((kase) => this.absorbCase(kase, round, next));
    return next;
  }

  /**
   * Closes the graph. `pendingFrontier` are the identifiers left unexpanded;
   * if any remain, the graph is a slice and is marked as such.
   */
  build(pendingFrontier: readonly EntityRef[]): EntityNetworkGraph {
    return {
      rootId: entityNodeKey(this.root.type, this.rootValue),
      nodes: [...this.nodes.values()],
      edges: [...this.edges],
      depthReached: this.depthReached,
      truncated: this.truncated || pendingFrontier.length > 0,
    };
  }

  /** `false` cuts the walk: the node ceiling was reached. */
  private absorbCase(kase: Case, round: number, next: EntityRef[]): boolean {
    const caseNodeId = `CASE:${kase.id}`;
    if (!this.ensureCaseNode(kase, caseNodeId, round)) {
      return false;
    }
    return entityIdentifiersOf(kase).every((ref) => this.absorbRef(ref, caseNodeId, round, next));
  }

  /** `false` cuts the walk: the node ceiling was reached. */
  private absorbRef(ref: EntityRef, caseNodeId: string, round: number, next: EntityRef[]): boolean {
    const entityId = entityNodeKey(ref.type, ref.value);
    if (!this.ensureEntityNode(ref, entityId, round)) {
      return false;
    }
    this.addEdge(caseNodeId, entityId, ref.type);
    if (this.visitedEntities.has(entityId)) {
      return true;
    }
    this.visitedEntities.add(entityId);
    next.push(ref);
    return true;
  }

  private ensureCaseNode(kase: Case, id: string, depth: number): boolean {
    if (this.nodes.has(id)) {
      return true;
    }
    if (this.atCapacity()) {
      this.truncated = true;
      return false;
    }
    this.nodes.set(id, {
      kind: 'CASE',
      id,
      caseId: kase.id,
      status: kase.status,
      priority: kase.priority,
      riskScore: kase.riskScore,
      depth,
    });
    return true;
  }

  private ensureEntityNode(ref: EntityRef, id: string, depth: number): boolean {
    if (this.nodes.has(id)) {
      return true;
    }
    if (this.atCapacity()) {
      this.truncated = true;
      return false;
    }
    this.nodes.set(id, { kind: 'ENTITY', id, type: ref.type, value: ref.value, depth });
    return true;
  }

  private atCapacity(): boolean {
    return this.nodes.size >= MAX_GRAPH_NODES;
  }

  private addEdge(from: string, to: string, type: EntityNodeType): void {
    const key = `${from}|${to}`;
    if (this.seenEdges.has(key)) {
      return;
    }
    this.seenEdges.add(key);
    this.edges.push({ from, to, type });
  }
}

function assertPositiveDepth(maxDepth: number): void {
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw invariantViolation('maxDepth must be an integer >= 1', { maxDepth });
  }
}

function assertNonEmptyRoot(type: EntityNodeType, value: string): void {
  if (value === '') {
    throw invariantViolation('root entity value must not be empty', { type });
  }
}

function assertRoundWithin(round: number, maxDepth: number): void {
  if (round < 1 || round > maxDepth) {
    throw invariantViolation('round must be within 1..maxDepth', { round, maxDepth });
  }
}

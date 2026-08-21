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
 * Arista `expediente → identificador`. El grafo es bipartito a propósito: no
 * emitimos aristas caso→caso.
 *
 * Decir "estos dos expedientes están conectados" sin más es justo la parte que
 * el analista no puede auditar, y en un expediente de fraude eso no vale: lo
 * que sostiene una acusación es *por qué* están conectados. Dejando el
 * identificador como nodo intermedio, el camino se lee solo —caso A → wallet
 * 0xabc → caso B— y el salto queda con su prueba pegada. Reconstruir la unión
 * caso-caso a partir de esto es trivial para quien la quiera; recuperar el
 * motivo a partir de una arista directa, imposible.
 */
export interface NetworkEdge {
  /** Id del nodo CASE. */
  readonly from: string;
  /** Id del nodo ENTITY. */
  readonly to: string;
  /** Por qué identificador conectan, para poder pintar y filtrar la arista. */
  readonly type: EntityNodeType;
}

export interface EntityNetworkGraph {
  /** Nodo por el que se empezó a expandir. */
  readonly rootId: string;
  readonly nodes: readonly NetworkNode[];
  readonly edges: readonly NetworkEdge[];
  /** Rondas de expansión efectivamente recorridas (`profundidad_explorada`). */
  readonly depthReached: number;
  /**
   * `true` cuando la expansión paró por alcanzar `maxDepth` o el techo de
   * nodos y quedaban identificadores sin visitar — es decir, el grafo NO es la
   * red completa. Se propaga al JSON para que nadie lea un grafo recortado
   * como si fuera exhaustivo.
   */
  readonly truncated: boolean;
}

/**
 * Identificadores que un expediente aporta a la red.
 *
 * Salen de los campos ya normalizados por la ingesta (`IngestFinturuCase`
 * extrae `idUserBridge`, `walletBridge`, `idCustomer`… de la maraña de formas
 * en que Finturu los manda) y no del `finturuCacheSnapshot` crudo. El snapshot
 * es un `Record<string, unknown>` congelado cuyas claves cambian según el
 * proveedor y la fecha; volver a escarbarlo aquí sería duplicar ese parseo en
 * un segundo sitio que se desincronizaría del primero.
 *
 * Los vacíos se descartan: un `customerEmail` en `''` no conecta a nadie, pero
 * como nodo agruparía bajo un mismo punto a todos los expedientes sin email.
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

/** Techo de nodos por grafo. Ver `EntityNetworkGraphBuilder`. */
export const MAX_GRAPH_NODES = 500;

/**
 * Acumulador de la exploración en anchura.
 *
 * El recorrido es bipartito y alterna: identificadores del frente → los
 * expedientes que los citan → los identificadores *nuevos* de esos
 * expedientes, que forman el frente siguiente. Una "ronda" es ese ciclo
 * completo, y es lo que cuenta `depthReached`.
 *
 * La E/S vive fuera: el caso de uso pregunta al repositorio y va entregando
 * expedientes con `absorb`, que devuelve el frente siguiente. Así toda la
 * lógica de grafo —deduplicación, profundidad, corte— se prueba sin Mongo.
 *
 * El techo de `MAX_GRAPH_NODES` no es una optimización: en un tenant con una
 * red grande, un identificador compartido por miles de expedientes (un email
 * de dominio corporativo, una wallet de exchange) hace estallar la expansión a
 * la ronda siguiente. Preferimos devolver un grafo recortado y marcado como
 * tal antes que tumbar la petición.
 *
 * Los recorridos usan `every` en vez de `for` + `break` porque el lint del
 * repo prohíbe anidar bloques (`max-depth: 1`): devolver `false` desde el
 * callback es aquí la forma de cortar.
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

  /** El frente inicial: solo la raíz. */
  frontier(): readonly EntityRef[] {
    return [{ type: this.root.type, value: this.rootValue }];
  }

  /**
   * Incorpora los expedientes que citan el frente actual y devuelve el frente
   * siguiente: los identificadores que aún no se habían visto.
   *
   * Devolver vacío significa que la red se agotó y el caso de uso puede parar
   * antes de llegar a `maxDepth` — el resultado es entonces la red completa,
   * no un recorte, y `truncated` se queda en `false`.
   */
  absorb(cases: readonly Case[], round: number): readonly EntityRef[] {
    assertRoundWithin(round, this.maxDepth);
    this.depthReached = Math.max(this.depthReached, round);

    const next: EntityRef[] = [];
    cases.every((kase) => this.absorbCase(kase, round, next));
    return next;
  }

  /**
   * Cierra el grafo. `pendingFrontier` son los identificadores que quedaron sin
   * expandir; si los hay, el grafo es un recorte y así se marca.
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

  /** `false` corta el recorrido: se alcanzó el techo de nodos. */
  private absorbCase(kase: Case, round: number, next: EntityRef[]): boolean {
    const caseNodeId = `CASE:${kase.id}`;
    if (!this.ensureCaseNode(kase, caseNodeId, round)) {
      return false;
    }
    return entityIdentifiersOf(kase).every((ref) => this.absorbRef(ref, caseNodeId, round, next));
  }

  /** `false` corta el recorrido: se alcanzó el techo de nodos. */
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

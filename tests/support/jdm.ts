/**
 * Lecturas tipadas sobre un grafo JDM, para los tests que comprueban lo que
 * construye `buildFactorScoringJdm`.
 *
 * El constructor devuelve `Record<string, unknown>` porque eso es lo que
 * guarda el agregado —el grafo es opaco para el dominio—, asi que sin esto
 * cada asercion tendria que abrirse paso con `any` y perderia justo lo que
 * esta comprobando: la forma.
 */
export interface JdmColumn {
  readonly id: string;
  readonly name: string;
  readonly field: string;
}

export interface JdmTableContent {
  readonly hitPolicy: string;
  readonly inputs: readonly JdmColumn[];
  readonly outputs: readonly JdmColumn[];
  readonly rules: readonly Record<string, string>[];
}

export interface JdmNode {
  readonly id: string;
  readonly type: string;
  readonly content?: { readonly source?: string } & Partial<JdmTableContent>;
}

export function nodesOf(graph: Record<string, unknown>): readonly JdmNode[] {
  return graph.nodes as readonly JdmNode[];
}

export function nodeOfType(graph: Record<string, unknown>, type: string): JdmNode {
  const node = nodesOf(graph).find((n) => n.type === type);
  if (node === undefined) {
    throw new Error(`the graph has no ${type}`);
  }
  return node;
}

/** La tabla de decision, que es donde vive la regla. */
export function tableOf(graph: Record<string, unknown>): JdmTableContent {
  return nodeOfType(graph, 'decisionTableNode').content as JdmTableContent;
}

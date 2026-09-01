/**
 * Evaluate-time JDM projection: add missing collect output columns `id`,
 * `name`, and `because` immediately before ZEN `createDecision`. Clones the
 * graph so in-memory `rule.conditions` / GET stay authored. Malformed input
 * returns the original reference; the function never throws.
 */

const JOIN = '; ';
type ContextField = 'id' | 'name' | 'because';

export function enrichCollectHitOutputs(
  graph: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  try {
    if (!isRecord(graph) || !Array.isArray(graph.nodes)) {
      return graph as Record<string, unknown>;
    }
    if (hasMalformedCollect(graph.nodes)) {
      return graph as Record<string, unknown>;
    }

    const cloned = structuredClone(graph) as Record<string, unknown>;
    for (const node of cloned.nodes as unknown[]) {
      if (!isCollectTable(node)) {
        continue;
      }
      enrichCollectTable(node);
    }
    return cloned;
  } catch {
    return graph as Record<string, unknown>;
  }
}

function hasMalformedCollect(nodes: unknown[]): boolean {
  for (const node of nodes) {
    if (!isRecord(node) || node.type !== 'decisionTableNode') {
      continue;
    }
    if (!isRecord(node.content)) {
      return true;
    }
    if (node.content.hitPolicy !== 'collect') {
      continue;
    }
    if (
      !Array.isArray(node.content.rules) ||
      !Array.isArray(node.content.outputs) ||
      !Array.isArray(node.content.inputs)
    ) {
      return true;
    }
  }
  return false;
}

function isCollectTable(node: unknown): node is Record<string, unknown> & {
  content: Record<string, unknown> & {
    inputs: unknown[];
    outputs: unknown[];
    rules: unknown[];
  };
} {
  if (!isRecord(node) || node.type !== 'decisionTableNode' || !isRecord(node.content)) {
    return false;
  }
  const content = node.content;
  return (
    content.hitPolicy === 'collect' &&
    Array.isArray(content.inputs) &&
    Array.isArray(content.outputs) &&
    Array.isArray(content.rules)
  );
}

function enrichCollectTable(node: Record<string, unknown> & {
  content: Record<string, unknown> & {
    inputs: unknown[];
    outputs: unknown[];
    rules: unknown[];
  };
}): void {
  const content = node.content;
  const outputs = content.outputs.filter(isRecord);
  content.outputs = outputs;

  const columnIds = {
    id: ensureOutputColumn(outputs, 'id', 'o_id'),
    name: ensureOutputColumn(outputs, 'name', 'o_name'),
    because: ensureOutputColumn(outputs, 'because', 'o_because'),
  };
  const inputs = content.inputs.filter(isRecord);
  const nodeName = nonEmptyString(node.name);

  for (const rule of content.rules) {
    if (!isRecord(rule)) {
      continue;
    }
    writeRuleContext(rule, inputs, columnIds, nodeName);
  }
}

function writeRuleContext(
  rule: Record<string, unknown>,
  inputs: Array<Record<string, unknown>>,
  columnIds: { id: string; name: string; because: string },
  nodeName: string | undefined,
): void {
  const rowId = nonEmptyString(rule._id);
  if (rowId !== undefined) {
    writeCell(rule, columnIds.id, JSON.stringify(rowId));
  }

  const filledInputs = inputs.filter((input) => {
    const inputId = nonEmptyString(input.id);
    return inputId !== undefined && !isEmptyCell(rule[inputId]);
  });

  const name =
    firstNonEmptyInputName(filledInputs) ?? rowId ?? nodeName;
  if (name !== undefined) {
    writeCell(rule, columnIds.name, JSON.stringify(name));
  }

  const because = deriveBecause(rule, filledInputs, rowId);
  if (because !== undefined) {
    writeCell(rule, columnIds.because, JSON.stringify(because));
  }
}

function firstNonEmptyInputName(filledInputs: Array<Record<string, unknown>>): string | undefined {
  for (const input of filledInputs) {
    const name = nonEmptyString(input.name);
    if (name !== undefined) {
      return name;
    }
  }
  return undefined;
}

function deriveBecause(
  rule: Record<string, unknown>,
  filledInputs: Array<Record<string, unknown>>,
  rowId: string | undefined,
): string | undefined {
  const parts = filledInputs.map((input) => {
    const inputId = input.id as string;
    return `${typeof input.name === 'string' ? input.name : ''} ${rule[inputId] as string}`;
  });
  if (parts.length === 0) {
    return rowId;
  }
  const joined = parts.join(JOIN);
  return rowId === undefined ? joined : `${rowId}: ${joined}`;
}

function ensureOutputColumn(
  outputs: Array<Record<string, unknown>>,
  field: ContextField,
  preferredId: string,
): string {
  const existing = outputs.find((column) => column.field === field);
  if (existing !== undefined) {
    const existingId = nonEmptyString(existing.id);
    if (existingId !== undefined) {
      return existingId;
    }
    const assigned = unusedOutputId(outputs, preferredId);
    existing.id = assigned;
    return assigned;
  }
  const id = unusedOutputId(outputs, preferredId);
  outputs.push({ id, name: field, field });
  return id;
}

function unusedOutputId(outputs: Array<Record<string, unknown>>, preferredId: string): string {
  const used = new Set(
    outputs.map((column) => column.id).filter((id): id is string => typeof id === 'string'),
  );
  if (!used.has(preferredId)) {
    return preferredId;
  }
  let suffix = 2;
  let candidate = `${preferredId}${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${preferredId}${suffix}`;
  }
  return candidate;
}

function writeCell(rule: Record<string, unknown>, columnId: string, value: string): void {
  if (!isEmptyCell(rule[columnId])) {
    return;
  }
  rule[columnId] = value;
}

function isEmptyCell(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

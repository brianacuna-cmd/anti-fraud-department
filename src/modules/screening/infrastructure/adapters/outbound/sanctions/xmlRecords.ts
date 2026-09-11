import { SaxesParser } from 'saxes';

/** One XML element with its subtree. Only built for the record being parsed. */
export interface XmlNode {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlNode[];
  text: string;
}

/**
 * Streams every `recordTag` element of a document as a small tree.
 *
 * The official lists run 20–30 MB. Building a DOM for the whole file would
 * hold several hundred MB at once in the API process; this keeps exactly one
 * record's subtree alive at a time and discards everything outside records.
 */
export async function* streamXmlRecords(chunks: AsyncIterable<string>, recordTag: string): AsyncGenerator<XmlNode> {
  const parser = new SaxesParser({ xmlns: false });
  const ready: XmlNode[] = [];
  const stack: XmlNode[] = [];
  let failure: Error | null = null;

  parser.on('opentag', (tag) => {
    if (stack.length === 0 && tag.name !== recordTag) return;
    const node: XmlNode = { name: tag.name, attributes: { ...tag.attributes }, children: [], text: '' };
    stack.at(-1)?.children.push(node);
    stack.push(node);
  });
  const appendText = (text: string): void => {
    const top = stack.at(-1);
    if (top !== undefined) top.text += text;
  };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  parser.on('closetag', () => {
    const node = stack.pop();
    if (node !== undefined && stack.length === 0) ready.push(node);
  });
  parser.on('error', (error) => {
    failure = error;
  });

  for await (const chunk of chunks) {
    parser.write(chunk);
    if (failure !== null) throw failure;
    yield* ready.splice(0);
  }
  parser.close();
  if (failure !== null) throw failure;
  yield* ready.splice(0);
}

/** Maps every `recordTag` element through `map`, dropping the ones it rejects with `null`. */
export async function collectRecords<T>(
  chunks: AsyncIterable<string>,
  recordTag: string,
  map: (node: XmlNode) => T | null,
): Promise<T[]> {
  const results: T[] = [];
  for await (const node of streamXmlRecords(chunks, recordTag)) {
    const mapped = map(node);
    if (mapped !== null) results.push(mapped);
  }
  return results;
}

export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name);
}

/** Trimmed text of the first direct child called `name`, or `''`. */
export function childText(node: XmlNode, name: string): string {
  return node.children.find((child) => child.name === name)?.text.trim() ?? '';
}

/** Every element called `name` anywhere below `node`, document order. */
export function descendantsNamed(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  const visit = (current: XmlNode): void => {
    for (const child of current.children) {
      if (child.name === name) found.push(child);
      visit(child);
    }
  };
  visit(node);
  return found;
}

export function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

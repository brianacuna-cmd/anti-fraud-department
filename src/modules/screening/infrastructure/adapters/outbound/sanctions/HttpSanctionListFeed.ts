import type { SanctionSource } from '../../../../domain/model/value-objects/SanctionSource.js';
import type { SanctionListFeed, SanctionedParty } from '../../../../domain/ports/SanctionListFeed.js';

export type SanctionListParser = (chunks: AsyncIterable<string>) => Promise<SanctionedParty[]>;

export interface HttpSanctionListFeedOptions {
  readonly source: SanctionSource;
  readonly url: string;
  readonly parse: SanctionListParser;
  readonly timeoutMs?: number;
  /** Injected in tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/** Generous: the EU file is ~26 MB and the publishers are not fast. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

async function* decodeUtf8(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8');
  for await (const chunk of body) {
    // `stream: true` keeps a multi-byte character split across two chunks intact.
    yield decoder.decode(chunk, { stream: true });
  }
  const tail = decoder.decode();
  if (tail.length > 0) yield tail;
}

/**
 * Downloads one official list and parses it while it streams in, so the
 * raw file is never held in memory as one string.
 */
export class HttpSanctionListFeed implements SanctionListFeed {
  readonly source: SanctionSource;

  constructor(private readonly options: HttpSanctionListFeedOptions) {
    this.source = options.source;
  }

  async fetchParties(): Promise<readonly SanctionedParty[]> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(this.options.url, {
      headers: { accept: 'application/xml, text/xml' },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok || response.body === null) {
      throw new Error(`${this.source}: download failed with HTTP ${response.status}`);
    }
    return this.options.parse(decodeUtf8(response.body as unknown as AsyncIterable<Uint8Array>));
  }
}

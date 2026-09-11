import { HttpSanctionListFeed } from '../../../src/modules/screening/infrastructure/adapters/outbound/sanctions/HttpSanctionListFeed.js';

const encoder = new TextEncoder();

function responseOf(chunks: Uint8Array[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, { status });
}

async function collect(chunks: AsyncIterable<string>): Promise<string[]> {
  const seen: string[] = [];
  for await (const chunk of chunks) seen.push(chunk);
  return seen;
}

describe('HttpSanctionListFeed', () => {
  it('decodes a character whose bytes arrive split across two network chunks', async () => {
    const bytes = encoder.encode('<name>Ñandú</name>');
    const split = bytes.indexOf(0xc3) + 1; // between the two bytes of "Ñ"
    let received: string[] = [];
    const feed = new HttpSanctionListFeed({
      source: 'EU_FSF',
      url: 'https://example.test/eu.xml',
      parse: async (chunks) => {
        received = await collect(chunks);
        return [];
      },
      fetchImpl: (async () => responseOf([bytes.slice(0, split), bytes.slice(split)])) as typeof fetch,
    });

    await feed.fetchParties();

    expect(received.join('')).toBe('<name>Ñandú</name>');
  });

  it('fails naming the list and the status when the publisher answers with an error', async () => {
    const parse = jest.fn();
    const feed = new HttpSanctionListFeed({
      source: 'OFAC_SDN',
      url: 'https://example.test/sdn.xml',
      parse,
      fetchImpl: (async () => responseOf([], 503)) as typeof fetch,
    });

    await expect(feed.fetchParties()).rejects.toThrow('OFAC_SDN: download failed with HTTP 503');
    expect(parse).not.toHaveBeenCalled();
  });

  it('requests the configured URL with a timeout', async () => {
    const fetchImpl = jest.fn(async () => responseOf([encoder.encode('<x/>')]));
    const feed = new HttpSanctionListFeed({
      source: 'UK_FCDO',
      url: 'https://example.test/uk.xml',
      parse: async () => [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await feed.fetchParties();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/uk.xml');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

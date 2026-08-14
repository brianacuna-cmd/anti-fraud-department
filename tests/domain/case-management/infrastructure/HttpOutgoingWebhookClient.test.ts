import { HttpOutgoingWebhookClient } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/http/HttpOutgoingWebhookClient.js';

describe('HttpOutgoingWebhookClient', () => {
  it('POSTs JSON and returns ok for 2xx responses', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(null, { status: 202 });
    };
    const client = new HttpOutgoingWebhookClient({ fetchImpl });

    const result = await client.post({
      url: 'https://hooks.example/fraud',
      payload: { enforcement_action_id: 'a1', case_id: 'c1' },
    });

    expect(result).toEqual({ statusCode: 202, ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://hooks.example/fraud');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ enforcement_action_id: 'a1', case_id: 'c1' }),
    );
  });

  it('returns ok:false with status code for non-2xx responses', async () => {
    const fetchImpl: typeof fetch = async () => new Response(null, { status: 503 });
    const client = new HttpOutgoingWebhookClient({ fetchImpl });

    const result = await client.post({
      url: 'https://hooks.example/fraud',
      payload: { a: 1 },
    });

    expect(result).toEqual({ statusCode: 503, ok: false });
  });

  it('maps network failures to statusCode 0 without throwing', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('network down');
    };
    const client = new HttpOutgoingWebhookClient({ fetchImpl });

    const result = await client.post({
      url: 'https://hooks.example/fraud',
      payload: { a: 1 },
    });

    expect(result).toEqual({ statusCode: 0, ok: false });
  });
});

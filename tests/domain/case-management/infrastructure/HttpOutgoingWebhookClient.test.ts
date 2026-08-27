import { createHmac } from 'node:crypto';
import { HttpOutgoingWebhookClient, SIGNATURE_HEADER } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/http/HttpOutgoingWebhookClient.js';

function hmacHex(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

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

describe('HttpOutgoingWebhookClient — outbound signature', () => {
  const SECRET = 's'.repeat(48);

  function capture() {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls.push({ init });
      return new Response(null, { status: 200 });
    };
    return { calls, fetchImpl };
  }

  it('omits x-signature-sha256 when the tenant has no secret', async () => {
    const { calls, fetchImpl } = capture();
    const client = new HttpOutgoingWebhookClient({ fetchImpl });

    await client.post({ url: 'https://hooks.example/x', payload: { a: 1 } });

    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers).toEqual({ 'content-type': 'application/json' });
    expect(headers['x-signature-sha256']).toBeUndefined();
  });

  it('omits x-signature-sha256 when the secret is empty', async () => {
    const { calls, fetchImpl } = capture();
    const client = new HttpOutgoingWebhookClient({ fetchImpl });

    await client.post({ url: 'https://hooks.example/x', payload: { a: 1 }, secret: '' });

    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers).toEqual({ 'content-type': 'application/json' });
    expect(headers['x-signature-sha256']).toBeUndefined();
  });

  it('sets x-signature-sha256 to HMAC-SHA256 hex of the exact POSTed JSON body', async () => {
    const { calls, fetchImpl } = capture();
    const client = new HttpOutgoingWebhookClient({ fetchImpl });

    await client.post({
      url: 'https://hooks.example/x',
      payload: { enforcement_action_id: 'a1' },
      secret: SECRET,
    });

    const headers = calls[0]?.init?.headers as Record<string, string>;
    const body = calls[0]?.init?.body as string;
    expect(SIGNATURE_HEADER).toBe('x-signature-sha256');
    expect(headers[SIGNATURE_HEADER]).toBe(hmacHex(SECRET, body));
    expect(headers[SIGNATURE_HEADER]).not.toMatch(/t=/);
  });

  it('signs the same JSON bytes that are POSTed', async () => {
    const { calls, fetchImpl } = capture();
    const client = new HttpOutgoingWebhookClient({ fetchImpl });

    await client.post({
      url: 'https://hooks.example/x',
      payload: { z: 'last', a: 'first', nested: { b: 2 } },
      secret: SECRET,
    });

    const headers = calls[0]?.init?.headers as Record<string, string>;
    const sentBody = calls[0]?.init?.body as string;
    expect(sentBody).toBe(JSON.stringify({ z: 'last', a: 'first', nested: { b: 2 } }));
    expect(headers[SIGNATURE_HEADER]).toBe(hmacHex(SECRET, sentBody));
  });

  it('does not send x-finturu-signature or a t=,v1= envelope', async () => {
    const { calls, fetchImpl } = capture();
    const client = new HttpOutgoingWebhookClient({ fetchImpl });

    await client.post({
      url: 'https://hooks.example/x',
      payload: { enforcement_action_id: 'a1' },
      secret: SECRET,
    });

    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['x-finturu-signature']).toBeUndefined();
    expect(headers[SIGNATURE_HEADER]).not.toMatch(/^t=\d+,v1=/);
    expect(Object.keys(headers).filter((name) => name.toLowerCase().includes('signature'))).toEqual([
      SIGNATURE_HEADER,
    ]);
  });

  it('fails verification when the body is tampered after signing', async () => {
    const { calls, fetchImpl } = capture();
    const client = new HttpOutgoingWebhookClient({ fetchImpl });

    await client.post({
      url: 'https://hooks.example/x',
      payload: { action: 'BLOCK' },
      secret: SECRET,
    });

    const headers = calls[0]?.init?.headers as Record<string, string>;
    const body = calls[0]?.init?.body as string;
    const header = headers[SIGNATURE_HEADER];
    expect(header).toBe(hmacHex(SECRET, body));
    const tampered = body.replace('BLOCK', 'UNBLOCK');
    expect(tampered).not.toBe(body);
    expect(hmacHex(SECRET, tampered)).not.toBe(header);
  });

  it('produces an identical MAC for the same payload and secret', async () => {
    const { calls, fetchImpl } = capture();
    const client = new HttpOutgoingWebhookClient({ fetchImpl });
    const payload = { enforcement_action_id: 'a1', action: 'BLOCK' };

    await client.post({ url: 'https://hooks.example/x', payload, secret: SECRET });
    await client.post({ url: 'https://hooks.example/x', payload, secret: SECRET });

    expect(calls).toHaveLength(2);
    const firstBody = calls[0]?.init?.body as string;
    const secondBody = calls[1]?.init?.body as string;
    const firstHeader = (calls[0]?.init?.headers as Record<string, string>)[SIGNATURE_HEADER];
    const secondHeader = (calls[1]?.init?.headers as Record<string, string>)[SIGNATURE_HEADER];
    expect(firstBody).toBe(secondBody);
    expect(firstHeader).toBe(hmacHex(SECRET, firstBody));
    expect(firstHeader).toBe(secondHeader);
  });
});

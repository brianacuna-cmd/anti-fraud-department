import { createHmac } from 'node:crypto';
import { StripeHmacVerifier } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/crypto/StripeHmacVerifier.js';
import { HttpOutgoingWebhookClient, SIGNATURE_HEADER } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/http/HttpOutgoingWebhookClient.js';

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

describe('HttpOutgoingWebhookClient — firma de salida (EVT-003)', () => {
  const SECRET = 's'.repeat(48);

  function capture() {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls.push({ init });
      return new Response(null, { status: 200 });
    };
    return { calls, fetchImpl };
  }

  it('no firma cuando el inquilino no tiene secreto', async () => {
    const { calls, fetchImpl } = capture();
    const client = new HttpOutgoingWebhookClient({ fetchImpl });

    await client.post({ url: 'https://hooks.example/x', payload: { a: 1 } });

    expect(calls[0]?.init?.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('firma HMAC-SHA256 sobre `${t}.${cuerpo}` con el formato t=,v1=', async () => {
    const { calls, fetchImpl } = capture();
    const client = new HttpOutgoingWebhookClient({ fetchImpl, nowSeconds: () => 1_770_000_000 });

    await client.post({
      url: 'https://hooks.example/x',
      payload: { enforcement_action_id: 'a1' },
      secret: SECRET,
    });

    const headers = calls[0]?.init?.headers as Record<string, string>;
    const body = calls[0]?.init?.body as string;
    const expected = createHmac('sha256', SECRET)
      .update(`1770000000.${body}`, 'utf8')
      .digest('hex');

    expect(headers[SIGNATURE_HEADER]).toBe(`t=1770000000,v1=${expected}`);
  });

  /**
   * El fallo clasico de este tipo de firma: serializar el cuerpo dos veces, una
   * para firmar y otra para enviar. Basta con que el orden de claves difiera
   * para que el receptor rechace todo y nadie entienda por que.
   */
  it('firma exactamente el cuerpo que se envia', async () => {
    const { calls, fetchImpl } = capture();
    const client = new HttpOutgoingWebhookClient({ fetchImpl, nowSeconds: () => 1_770_000_000 });

    await client.post({
      url: 'https://hooks.example/x',
      payload: { z: 'ultimo', a: 'primero', anidado: { b: 2 } },
      secret: SECRET,
    });

    const headers = calls[0]?.init?.headers as Record<string, string>;
    const sentBody = calls[0]?.init?.body as string;
    const signature = headers[SIGNATURE_HEADER]!.split('v1=')[1];
    const recomputed = createHmac('sha256', SECRET)
      .update(`1770000000.${sentBody}`, 'utf8')
      .digest('hex');

    expect(signature).toBe(recomputed);
  });

  it('un secreto vacio se trata como ausente, no como secreto ""', async () => {
    const { calls, fetchImpl } = capture();
    const client = new HttpOutgoingWebhookClient({ fetchImpl });

    await client.post({ url: 'https://hooks.example/x', payload: { a: 1 }, secret: '' });

    expect(calls[0]?.init?.headers).toEqual({ 'content-type': 'application/json' });
  });
});

/**
 * La afirmacion del comentario del cliente -"el formato es el de Stripe"- no
 * vale nada sin esto. Si el formato se desvia, quien reciba nuestros envios con
 * codigo de Stripe los rechazara en silencio y el canal quedara mudo.
 *
 * Se verifica bajo el nombre de cabecera que espera el verificador: lo que se
 * comprueba aqui es el FORMATO de la firma, no como se llama la cabecera.
 */
describe('firma de salida ↔ StripeHmacVerifier (ida y vuelta)', () => {
  it('lo que firmamos lo acepta el mismo verificador que usamos en la entrada', async () => {
    const SECRET = 'r'.repeat(48);
    const now = Math.floor(Date.now() / 1000);
    let sent: { body: string; header: string } | null = null;

    const fetchImpl: typeof fetch = async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      sent = { body: init?.body as string, header: headers[SIGNATURE_HEADER]! };
      return new Response(null, { status: 200 });
    };

    const client = new HttpOutgoingWebhookClient({ fetchImpl, nowSeconds: () => now });
    await client.post({
      url: 'https://hooks.example/x',
      payload: { enforcement_action_id: 'a1', action: 'BLOCK' },
      secret: SECRET,
    });

    const delivered = sent as unknown as { body: string; header: string };
    const accepted = new StripeHmacVerifier().verify(
      Buffer.from(delivered.body, 'utf8'),
      { 'stripe-signature': delivered.header },
      SECRET,
    );

    expect(accepted).toBe(true);
  });

  it('y lo rechaza si el cuerpo cambia despues de firmar', async () => {
    const SECRET = 'r'.repeat(48);
    const now = Math.floor(Date.now() / 1000);
    let sent: { body: string; header: string } | null = null;

    const fetchImpl: typeof fetch = async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      sent = { body: init?.body as string, header: headers[SIGNATURE_HEADER]! };
      return new Response(null, { status: 200 });
    };

    const client = new HttpOutgoingWebhookClient({ fetchImpl, nowSeconds: () => now });
    await client.post({
      url: 'https://hooks.example/x',
      payload: { action: 'BLOCK' },
      secret: SECRET,
    });

    const delivered = sent as unknown as { body: string; header: string };
    const tampered = delivered.body.replace('BLOCK', 'UNBLOCK');
    const accepted = new StripeHmacVerifier().verify(
      Buffer.from(tampered, 'utf8'),
      { 'stripe-signature': delivered.header },
      SECRET,
    );

    expect(accepted).toBe(false);
  });
});

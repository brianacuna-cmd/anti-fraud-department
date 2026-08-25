import { createHmac } from 'node:crypto';
import type {
  OutgoingWebhookClient,
  OutgoingWebhookPostInput,
  OutgoingWebhookPostResult,
} from '../../../../domain/ports/OutgoingWebhookClient.js';

export interface HttpOutgoingWebhookClientOptions {
  /** Injectable fetch for tests; defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Injectable clock for tests; defaults to `Date.now`. Seconds since epoch. */
  readonly nowSeconds?: () => number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Cabecera de firma. El nombre es nuestro; el formato es el de Stripe. */
export const SIGNATURE_HEADER = 'x-finturu-signature';
const SIGNATURE_SCHEME = 'v1';

/**
 * Production `OutgoingWebhookClient` — POSTs JSON payload to the tenant webhook URL.
 * Network/HTTP failures map to `{ ok: false }` (never throw) so the dispatcher can record attempts.
 *
 * EVT-003 — FIRMA DE SALIDA
 *
 * Cuando el inquilino tiene secreto configurado, la entrega va firmada con
 * HMAC-SHA256 sobre `${t}.${cuerpo}` en la cabecera `x-finturu-signature`,
 * con el formato `t=<epoch>,v1=<hex>`.
 *
 * POR QUE ESTE FORMATO Y NO UNO PROPIO
 *
 * Es exactamente el que `StripeHmacVerifier` ya verifica en la entrada. Quien
 * reciba esto casi seguro tiene codigo de Stripe funcionando, y darle un
 * esquema conocido es la diferencia entre que verifique la firma y que la
 * ignore porque implementarla era trabajo.
 *
 * POR QUE EL TIMESTAMP VA DENTRO DE LO FIRMADO
 *
 * Sin el, una entrega capturada se puede reenviar indefinidamente y seguira
 * verificando. Firmar `t` junto al cuerpo permite al receptor rechazar lo
 * viejo — que es lo unico que convierte la firma en proteccion contra repeticion
 * y no solo en prueba de origen.
 *
 * El cuerpo se serializa UNA vez y se firma ese string exacto. Serializarlo dos
 * veces (una para firmar, otra para enviar) es como se producen las firmas que
 * no verifican por una diferencia de orden de claves.
 */
export class HttpOutgoingWebhookClient implements OutgoingWebhookClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly nowSeconds: () => number;

  constructor(options: HttpOutgoingWebhookClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  async post(input: OutgoingWebhookPostInput): Promise<OutgoingWebhookPostResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const body = JSON.stringify(input.payload);
    try {
      const response = await this.fetchImpl(input.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.signatureHeader(body, input.secret ?? null),
        },
        body,
        signal: controller.signal,
      });
      return {
        statusCode: response.status,
        ok: response.ok,
      };
    } catch {
      return { statusCode: 0, ok: false };
    } finally {
      clearTimeout(timer);
    }
  }

  private signatureHeader(body: string, secret: string | null): Record<string, string> {
    if (secret === null || secret.length === 0) {
      return {};
    }
    const timestamp = this.nowSeconds();
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`, 'utf8')
      .digest('hex');
    return { [SIGNATURE_HEADER]: `t=${timestamp},${SIGNATURE_SCHEME}=${signature}` };
  }
}

import { createHmac } from 'node:crypto';
import { StripeHmacVerifier } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/crypto/StripeHmacVerifier.js';

const SECRET = 'whsec_test_live';
const BODY = Buffer.from('{"id":"evt_1","type":"charge.succeeded"}', 'utf8');

function stripeSignature(secret: string, rawBody: Buffer, timestampSeconds = Math.floor(Date.now() / 1000)): string {
  const signedPayload = `${timestampSeconds}.${rawBody.toString('utf8')}`;
  const v1 = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  return `t=${timestampSeconds},v1=${v1}`;
}

describe('StripeHmacVerifier', () => {
  const verifier = new StripeHmacVerifier();

  it('accepts a valid Stripe-Signature t=,v1= HMAC over the raw Buffer', () => {
    const header = stripeSignature(SECRET, BODY);

    expect(verifier.verify(BODY, { 'Stripe-Signature': header }, SECRET)).toBe(true);
  });

  it('accepts a lowercase stripe-signature header (Express)', () => {
    const header = stripeSignature(SECRET, BODY);

    expect(verifier.verify(BODY, { 'stripe-signature': header }, SECRET)).toBe(true);
  });

  it('fails closed when the raw body is tampered (S03)', () => {
    const header = stripeSignature(SECRET, BODY);
    const tampered = Buffer.from('{"id":"evt_1","type":"charge.failed"}', 'utf8');

    expect(verifier.verify(tampered, { 'Stripe-Signature': header }, SECRET)).toBe(false);
  });

  it('fails closed when Stripe-Signature is missing (S04)', () => {
    expect(verifier.verify(BODY, {}, SECRET)).toBe(false);
  });

  it('fails closed when v1 does not match the secret', () => {
    const header = stripeSignature('whsec_other', BODY);

    expect(verifier.verify(BODY, { 'Stripe-Signature': header }, SECRET)).toBe(false);
  });

  it('fails closed when the timestamp is outside tolerance', () => {
    const header = stripeSignature(SECRET, BODY, 1);

    expect(verifier.verify(BODY, { 'Stripe-Signature': header }, SECRET)).toBe(false);
  });

  it('accepts a matching v1 when the header lists multiple signatures', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const valid = stripeSignature(SECRET, BODY, timestamp);
    const header = `t=${timestamp},v1=deadbeef,${valid.slice(valid.indexOf('v1='))}`;

    expect(verifier.verify(BODY, { 'Stripe-Signature': header }, SECRET)).toBe(true);
  });
});

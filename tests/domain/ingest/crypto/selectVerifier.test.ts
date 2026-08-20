import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import { IngestError } from '../../../../src/modules/ingest/domain/errors/IngestError.js';
import { StripeHmacVerifier } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/crypto/StripeHmacVerifier.js';
import { BridgePkiVerifier } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/crypto/BridgePkiVerifier.js';
import { CoinflowValidationKeyVerifier } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/crypto/CoinflowValidationKeyVerifier.js';
import { selectVerifier } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/crypto/selectVerifier.js';

describe('selectVerifier', () => {
  it('returns StripeHmacVerifier for stripe', () => {
    expect(selectVerifier('stripe')).toBeInstanceOf(StripeHmacVerifier);
  });

  it('returns BridgePkiVerifier for bridge', () => {
    expect(selectVerifier('bridge')).toBeInstanceOf(BridgePkiVerifier);
  });

  it('returns CoinflowValidationKeyVerifier for coinflow', () => {
    expect(selectVerifier('coinflow')).toBeInstanceOf(CoinflowValidationKeyVerifier);
  });

  it('throws INVARIANT_VIOLATION for an unknown provider', () => {
    expect(() => selectVerifier('paypal' as 'stripe')).toThrow(IngestError);
    try {
      selectVerifier('paypal' as 'stripe');
    } catch (error) {
      expect((error as IngestError).code).toBe('INVARIANT_VIOLATION');
    }
  });

  it('selected stripe verifier accepts a valid HMAC fixture', () => {
    const body = Buffer.from('{"id":"evt_1"}', 'utf8');
    const secret = 'whsec_select';
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', secret).update(`${t}.${body.toString('utf8')}`, 'utf8').digest('hex');

    expect(
      selectVerifier('stripe').verify(body, { 'Stripe-Signature': `t=${t},v1=${v1}` }, secret),
    ).toBe(true);
  });

  it('selected bridge verifier accepts a valid PKI fixture', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const body = Buffer.from('{"event_id":"e1"}', 'utf8');
    const t = Date.now();
    const signer = createSign('RSA-SHA256');
    signer.update(`${t}.${body.toString('utf8')}`);
    signer.end();
    const v0 = signer.sign(privateKey, 'base64');

    expect(
      selectVerifier('bridge').verify(body, { 'X-Webhook-Signature': `t=${t},v0=${v0}` }, publicKey),
    ).toBe(true);
  });
});

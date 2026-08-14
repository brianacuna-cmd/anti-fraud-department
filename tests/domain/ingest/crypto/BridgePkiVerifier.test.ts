import { createSign, generateKeyPairSync } from 'node:crypto';
import { BridgePkiVerifier } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/crypto/BridgePkiVerifier.js';

const BODY = Buffer.from('{"event_id":"evt_bridge_1","event_type":"transfer.created"}', 'utf8');

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function bridgeSignature(rawBody: Buffer, timestampMs = Date.now()): string {
  const signedPayload = `${timestampMs}.${rawBody.toString('utf8')}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signedPayload);
  signer.end();
  const v0 = signer.sign(privateKey, 'base64');
  return `t=${timestampMs},v0=${v0}`;
}

describe('BridgePkiVerifier', () => {
  const verifier = new BridgePkiVerifier();

  it('accepts a valid X-Webhook-Signature t=,v0= RSA signature over the raw Buffer', () => {
    const header = bridgeSignature(BODY);

    expect(verifier.verify(BODY, { 'X-Webhook-Signature': header }, publicKey)).toBe(true);
  });

  it('accepts a lowercase x-webhook-signature header (Express)', () => {
    const header = bridgeSignature(BODY);

    expect(verifier.verify(BODY, { 'x-webhook-signature': header }, publicKey)).toBe(true);
  });

  it('fails closed when the raw body is tampered', () => {
    const header = bridgeSignature(BODY);
    const tampered = Buffer.from('{"event_id":"evt_bridge_1","event_type":"transfer.updated"}', 'utf8');

    expect(verifier.verify(tampered, { 'X-Webhook-Signature': header }, publicKey)).toBe(false);
  });

  it('fails closed when X-Webhook-Signature is missing', () => {
    expect(verifier.verify(BODY, {}, publicKey)).toBe(false);
  });

  it('fails closed when the public key material cannot verify the signature', () => {
    const { publicKey: otherPublic } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const header = bridgeSignature(BODY);

    expect(verifier.verify(BODY, { 'X-Webhook-Signature': header }, otherPublic)).toBe(false);
  });

  it('fails closed when the timestamp is older than ten minutes', () => {
    const header = bridgeSignature(BODY, Date.now() - 11 * 60 * 1000);

    expect(verifier.verify(BODY, { 'X-Webhook-Signature': header }, publicKey)).toBe(false);
  });

  it('fails closed when decrypted key material is not a valid PEM public key', () => {
    const header = bridgeSignature(BODY);

    expect(verifier.verify(BODY, { 'X-Webhook-Signature': header }, 'not-a-pem-key')).toBe(false);
  });
});

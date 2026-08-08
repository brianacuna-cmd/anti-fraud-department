import { generateKeyPairSync, sign } from 'node:crypto';
import { NodeAdminSignatureVerifier } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/NodeAdminSignatureVerifier.js';

function generateEd25519KeyPair(): { publicKeySpkiPem: string; privateKeyPkcs8Pem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeySpkiPem: publicKey as unknown as string, privateKeyPkcs8Pem: privateKey as unknown as string };
}

describe('NodeAdminSignatureVerifier', () => {
  it('accepts a valid Ed25519 signature produced by the matching private key (real keypair round-trip)', () => {
    const { publicKeySpkiPem, privateKeyPkcs8Pem } = generateEd25519KeyPair();
    const message = Buffer.from('AFD-ADMIN-CHALLENGE-V1\nsome-challenge-value', 'utf8');
    const signatureBase64 = sign(null, message, privateKeyPkcs8Pem).toString('base64');
    const verifier = new NodeAdminSignatureVerifier();

    expect(verifier.verify(message, signatureBase64, publicKeySpkiPem)).toBe(true);
  });

  it('rejects a signature when the message has been tampered with', () => {
    const { publicKeySpkiPem, privateKeyPkcs8Pem } = generateEd25519KeyPair();
    const message = Buffer.from('AFD-ADMIN-CHALLENGE-V1\nsome-challenge-value', 'utf8');
    const signatureBase64 = sign(null, message, privateKeyPkcs8Pem).toString('base64');
    const tamperedMessage = Buffer.from('AFD-ADMIN-CHALLENGE-V1\nsome-other-value', 'utf8');
    const verifier = new NodeAdminSignatureVerifier();

    expect(verifier.verify(tamperedMessage, signatureBase64, publicKeySpkiPem)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const { publicKeySpkiPem, privateKeyPkcs8Pem } = generateEd25519KeyPair();
    const message = Buffer.from('AFD-ADMIN-CHALLENGE-V1\nsome-challenge-value', 'utf8');
    const signature = sign(null, message, privateKeyPkcs8Pem);
    signature[signature.length - 1] = (signature[signature.length - 1]! ^ 0xff) & 0xff;
    const verifier = new NodeAdminSignatureVerifier();

    expect(verifier.verify(message, signature.toString('base64'), publicKeySpkiPem)).toBe(false);
  });

  it('rejects a signature verified against the wrong public key', () => {
    const first = generateEd25519KeyPair();
    const second = generateEd25519KeyPair();
    const message = Buffer.from('AFD-ADMIN-CHALLENGE-V1\nsome-challenge-value', 'utf8');
    const signatureBase64 = sign(null, message, first.privateKeyPkcs8Pem).toString('base64');
    const verifier = new NodeAdminSignatureVerifier();

    expect(verifier.verify(message, signatureBase64, second.publicKeySpkiPem)).toBe(false);
  });

  it('returns false, never throws, for a malformed public key PEM', () => {
    const message = Buffer.from('AFD-ADMIN-CHALLENGE-V1\nsome-challenge-value', 'utf8');
    const verifier = new NodeAdminSignatureVerifier();

    expect(verifier.verify(message, 'not-a-real-signature', 'not-a-real-pem')).toBe(false);
  });

  it('returns false, never throws, for a malformed base64 signature', () => {
    const { publicKeySpkiPem } = generateEd25519KeyPair();
    const message = Buffer.from('AFD-ADMIN-CHALLENGE-V1\nsome-challenge-value', 'utf8');
    const verifier = new NodeAdminSignatureVerifier();

    expect(verifier.verify(message, '***not-base64***', publicKeySpkiPem)).toBe(false);
  });
});

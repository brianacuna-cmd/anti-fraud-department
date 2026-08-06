import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { NodeAdminKeyPairGenerator } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/NodeAdminKeyPairGenerator.js';

describe('NodeAdminKeyPairGenerator', () => {
  it('generates an Ed25519 keypair as SPKI (public) / PKCS8 (private) PEM', () => {
    const generator = new NodeAdminKeyPairGenerator();

    const { publicKeySpkiPem, privateKeyPkcs8Pem } = generator.generate();

    expect(publicKeySpkiPem).toContain('BEGIN PUBLIC KEY');
    expect(privateKeyPkcs8Pem).toContain('BEGIN PRIVATE KEY');

    const publicKey = createPublicKey(publicKeySpkiPem);
    const privateKey = createPrivateKey(privateKeyPkcs8Pem);
    expect(publicKey.asymmetricKeyType).toBe('ed25519');
    expect(privateKey.asymmetricKeyType).toBe('ed25519');
  });

  it('produces a different keypair on every call', () => {
    const generator = new NodeAdminKeyPairGenerator();

    const first = generator.generate();
    const second = generator.generate();

    expect(first.publicKeySpkiPem).not.toBe(second.publicKeySpkiPem);
    expect(first.privateKeyPkcs8Pem).not.toBe(second.privateKeyPkcs8Pem);
  });

  it('the generated keypair actually matches — signing with the private key verifies against the public key', () => {
    const generator = new NodeAdminKeyPairGenerator();

    const { publicKeySpkiPem, privateKeyPkcs8Pem } = generator.generate();
    const data = Buffer.from('some challenge nonce');
    const signature = sign(null, data, createPrivateKey(privateKeyPkcs8Pem));

    expect(verify(null, data, createPublicKey(publicKeySpkiPem), signature)).toBe(true);
  });
});

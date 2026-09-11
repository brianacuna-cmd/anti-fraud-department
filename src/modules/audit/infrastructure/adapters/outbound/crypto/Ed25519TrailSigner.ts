import { createPrivateKey, createPublicKey, sign as nodeSign, type KeyObject } from 'node:crypto';
import type { TrailSignature, TrailSigner } from '../../../../domain/ports/TrailSigner.js';

/**
 * Firma Ed25519 sobre los bytes del volcado (AUD-003).
 *
 * La clave privada llega en PEM por configuración y NUNCA se persiste ni se
 * registra. La pública se deriva de ella y viaja en cada respuesta: es lo que
 * permite a un auditor verificar sin pedirle nada a este sistema.
 *
 * Ed25519 y no RSA: firma en un solo paso sobre el mensaje completo, sin
 * elegir función de hash ni relleno, que son justo los dos parámetros donde
 * una firma mal configurada parece válida y no lo es.
 */
export class Ed25519TrailSigner implements TrailSigner {
  private readonly privateKey: KeyObject | null;
  private readonly publicKeyPem: string | null;

  constructor(privateKeyPem: string | undefined) {
    if (privateKeyPem === undefined || privateKeyPem.trim().length === 0) {
      this.privateKey = null;
      this.publicKeyPem = null;
      return;
    }

    const key = createPrivateKey(privateKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') {
      /*
       * Se rechaza al ARRANCAR, no al primer export.
       *
       * Una clave del tipo equivocado configurada por error saldría a la luz
       * el día que un auditor pide el fichero, que es el peor momento posible
       * para descubrir un fallo de configuración.
       */
      throw new Error(
        `AUDIT_SIGNING_PRIVATE_KEY must be an Ed25519 key, got "${key.asymmetricKeyType}"`,
      );
    }

    this.privateKey = key;
    this.publicKeyPem = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
  }

  sign(payload: Buffer): TrailSignature | null {
    if (this.privateKey === null || this.publicKeyPem === null) return null;
    return {
      algorithm: 'Ed25519',
      // `null` como algoritmo de digest: Ed25519 firma el mensaje entero, no
      // un hash previo. Pasarle uno produciria una firma que no verifica.
      signature: nodeSign(null, payload, this.privateKey).toString('base64'),
      publicKeyPem: this.publicKeyPem,
    };
  }
}

import crypto from 'crypto';

export interface EncryptedWebhookPayload {
  readonly iv: string;
  readonly data: string;
  readonly authTag: string;
}

export function isEncryptedPayload(body: unknown): body is EncryptedWebhookPayload {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.iv === 'string' && typeof b.data === 'string' && typeof b.authTag === 'string';
}

export function decryptFinturuPayload(body: unknown, secretKey?: string): Record<string, unknown> {
  if (!isEncryptedPayload(body)) {
    if (typeof body === 'object' && body !== null) {
      return body as Record<string, unknown>;
    }
    throw new Error('Payload inválido: debe ser un objeto JSON o un payload encriptado { iv, data, authTag }');
  }

  const keyBase64 = secretKey ?? process.env.FRAUD_DEPARTMENT_KEY;
  if (!keyBase64) {
    throw new Error('FRAUD_DEPARTMENT_KEY no está configurada en las variables de entorno para desencriptar el payload');
  }

  try {
    const key = Buffer.from(keyBase64, 'base64');
    const iv = Buffer.from(body.iv, 'base64');
    const authTag = Buffer.from(body.authTag, 'base64');
    const encrypted = Buffer.from(body.data, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    const parsed = JSON.parse(decrypted.toString('utf-8'));
    // `null` is a legitimate reply: it is what searches that find nothing
    // return (e.g. an email with no Stripe customer). Rejecting it turned a
    // "does not exist" into a decryption error.
    if (parsed !== null && typeof parsed !== 'object') {
      throw new Error('El contenido desencriptado no es un objeto JSON válido');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Error al desencriptar payload AES-256-GCM: ${(error as Error).message}`);
  }
}

import { createHash } from 'node:crypto';
import {
  GetObjectLockConfigurationCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ArchivedObject, ColdStorage } from '../../../../domain/ports/ColdStorage.js';

export interface S3ColdStorageOptions {
  readonly bucket: string;
  readonly region: string;
  /** Años que el objeto queda bloqueado. Debe cubrir la retención legal. */
  readonly retentionYears: number;
  readonly endpoint?: string;
  readonly forcePathStyle?: boolean;
  readonly client?: S3Client;
}

/**
 * Archivado en frío sobre S3 con Object Lock (AUD-004).
 *
 * Las credenciales NO se leen aquí: se dejan a la cadena por defecto del SDK
 * (variables de entorno, perfil, rol de instancia o de pod), igual que en
 * `S3EvidenceStore`. Un servicio que corre en AWS con un rol asociado no debe
 * tener nunca una clave escrita en su configuración, y aceptarla como
 * parámetro invita precisamente a eso.
 */
export class S3ColdStorage implements ColdStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly retentionYears: number;

  constructor(options: S3ColdStorageOptions) {
    this.bucket = options.bucket;
    this.retentionYears = options.retentionYears;
    this.client =
      options.client ??
      new S3Client({
        region: options.region,
        ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
        ...(options.forcePathStyle === undefined ? {} : { forcePathStyle: options.forcePathStyle }),
      });
  }

  /**
   * Comprueba que el bucket tiene Object Lock ACTIVO.
   *
   * Se llama al arrancar, no al primer archivado. Sin Object Lock todo
   * funciona igual —los objetos se suben, el job dice que archivó— y la
   * inmutabilidad que justifica este módulo no existe. Un fallo silencioso
   * así se descubre el día que un auditor pregunta si los registros se pueden
   * borrar, y para entonces llevan un año sin protección.
   */
  async assertObjectLockEnabled(): Promise<void> {
    const res = await this.client.send(
      new GetObjectLockConfigurationCommand({ Bucket: this.bucket }),
    );
    if (res.ObjectLockConfiguration?.ObjectLockEnabled !== 'Enabled') {
      throw new Error(
        `bucket "${this.bucket}" does not have S3 Object Lock enabled: the audit archive would not be immutable`,
      );
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<ArchivedObject> {
    const retainUntil = new Date();
    retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + this.retentionYears);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        /*
         * COMPLIANCE y no GOVERNANCE.
         *
         * En modo GOVERNANCE, un usuario con el permiso adecuado puede
         * levantar el bloqueo; en COMPLIANCE no puede nadie, ni la cuenta
         * raíz, hasta que venza la retención. La diferencia es justo lo que un
         * auditor viene a comprobar: GOVERNANCE protege de un error,
         * COMPLIANCE protege de una decisión.
         */
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: retainUntil,
      }),
    );

    return {
      key,
      bytes: body.byteLength,
      sha256: createHash('sha256').update(body).digest('hex'),
      retainUntil: retainUntil.toISOString(),
    };
  }
}

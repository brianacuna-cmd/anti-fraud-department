import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { EvidenceStore } from '../../../../domain/ports/EvidenceStore.js';

export interface S3EvidenceStoreOptions {
  readonly bucket: string;
  readonly region: string;
  /** Prefijo dentro del bucket. Permite compartir bucket entre entornos. */
  readonly prefix?: string;
  /** Endpoint alternativo (MinIO, LocalStack). Ausente = AWS. */
  readonly endpoint?: string;
  /**
   * `true` para MinIO y compatibles, que no resuelven `bucket.host`. En AWS se
   * deja en falso: el estilo path está deprecado allí.
   */
  readonly forcePathStyle?: boolean;
  readonly client?: S3Client;
}

/**
 * `EvidenceStore` sobre S3 (INV-002) con descarga prefirmada (INV-004).
 *
 * Las credenciales NO se leen aquí: se dejan a la cadena por defecto del SDK
 * (variables de entorno, perfil, rol de la instancia o del pod). Un servicio
 * que corre en AWS con un rol asociado no debe tener nunca una clave escrita
 * en su configuración, y aceptarla por parámetro invita justamente a eso.
 *
 * `put` no lleva `ChecksumAlgorithm` ni verifica el hash: `RegisterEvidence`
 * ya calcula el SHA-256 sobre los bytes antes de llamar aquí, y ese es el hash
 * que se sella con la TSA. Recalcular otro distinto en la capa de transporte
 * solo crearía dos verdades sobre el mismo fichero.
 */
export class S3EvidenceStore implements EvidenceStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(options: S3EvidenceStoreOptions) {
    this.bucket = options.bucket;
    this.prefix = normalizePrefix(options.prefix);
    this.client =
      options.client ??
      new S3Client({
        region: options.region,
        ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
        ...(options.forcePathStyle === undefined ? {} : { forcePathStyle: options.forcePathStyle }),
      });
  }

  async put(storageKey: string, bytes: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.keyFor(storageKey),
        Body: bytes,
        ...(contentType === undefined ? {} : { ContentType: contentType }),
      }),
    );
  }

  async get(storageKey: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.keyFor(storageKey) }),
      );
      if (response.Body === undefined) {
        return null;
      }
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * URL temporal de descarga directa desde S3.
   *
   * El fichero no pasa por la API: una pieza de evidencia puede ser un volcado
   * de transacciones de cientos de megas, y hacerla atravesar el proceso Node
   * lo bloquea mientras dura. La caducidad es corta y la decide quien llama,
   * porque la URL, una vez emitida, vale para cualquiera que la tenga: es un
   * permiso al portador y su ventana es toda la protección que hay.
   */
  async presignDownload(storageKey: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: this.keyFor(storageKey) }),
      { expiresIn: expiresInSeconds },
    );
  }

  private keyFor(storageKey: string): string {
    return `${this.prefix}${storageKey}`;
  }
}

function normalizePrefix(prefix: string | undefined): string {
  if (prefix === undefined || prefix === '') {
    return '';
  }
  const trimmed = prefix.replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '' : `${trimmed}/`;
}

/**
 * S3 responde `NoSuchKey` al GET de un objeto ausente, pero un bucket sin
 * permiso de `ListBucket` devuelve `AccessDenied` en su lugar. Tratamos ambos
 * como 404 igual que el adaptador de filesystem hace con ENOENT.
 */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { name?: string }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

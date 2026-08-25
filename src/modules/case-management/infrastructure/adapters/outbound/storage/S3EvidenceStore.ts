import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { EvidenceStore } from '../../../../domain/ports/EvidenceStore.js';

export interface S3EvidenceStoreOptions {
  readonly bucket: string;
  readonly region: string;
  /** Prefix inside the bucket. Lets environments share a bucket. */
  readonly prefix?: string;
  /** Alternate endpoint (MinIO, LocalStack). Absent = AWS. */
  readonly endpoint?: string;
  /**
   * `true` for MinIO and compatibles, which do not resolve `bucket.host`. On
   * AWS it is left false: path style is deprecated there.
   */
  readonly forcePathStyle?: boolean;
  readonly client?: S3Client;
}

/**
 * `EvidenceStore` on S3 (INV-002) with presigned download (INV-004).
 *
 * Credentials are NOT read here: they are left to the SDK default chain
 * (environment variables, profile, instance or pod role). A service that
 * runs on AWS with an associated role must never have a key written in its
 * configuration, and accepting one as a parameter invites exactly that.
 *
 * `put` does not carry `ChecksumAlgorithm` nor verify the hash:
 * `RegisterEvidence` already computes SHA-256 over the bytes before calling
 * here, and that is the hash sealed with the TSA. Recalculating a different
 * one in the transport layer would only create two truths about the same
 * file.
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
   * Temporary URL for a direct download from S3.
   *
   * The file does not pass through the API: a piece of evidence can be a dump
   * of hundreds of megabytes of transactions, and making it traverse the Node
   * process blocks it for as long as it lasts. Expiry is short and decided by
   * the caller, because once issued the URL is valid for anyone who has it:
   * it is a bearer grant and its window is all the protection there is.
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
 * S3 answers `NoSuchKey` on GET of a missing object, but a bucket without
 * `ListBucket` permission returns `AccessDenied` instead. We treat both as
 * 404 the same way the filesystem adapter does with ENOENT.
 */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { name?: string }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

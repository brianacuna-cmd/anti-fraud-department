import type { Instant } from '../../../../../shared/time/Instant.js';
import type { AdminKeyId } from './AdminKeyId.js';
import type { AdminKeyStatus } from './AdminKeyStatus.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

/**
 * One element of `AdminOrganization`'s embedded `keys[]` array (design D31).
 * Not a branded id — a plain, immutable structure like `PasswordCredential`.
 * `encryptedPrivateKey`/`privateKeyDownloadedAt` are nullable: the one-time
 * download CAS (D32a) `$set`s both to `null`/a value in the same operation,
 * so "already downloaded" and "never downloaded" must both be representable.
 */
export interface AdminKey {
  readonly keyId: AdminKeyId;
  readonly publicKey: string;
  readonly status: AdminKeyStatus;
  readonly encryptedPrivateKey: string | null;
  readonly privateKeyDownloadedAt: Instant | null;
  readonly createdAt: Instant;
  readonly rotatedAt: Instant | null;
  readonly revokedAt: Instant | null;
}

export interface CreateAdminKeyInput {
  readonly keyId: AdminKeyId;
  readonly publicKey: string;
  readonly status: AdminKeyStatus;
  readonly encryptedPrivateKey: string | null;
  readonly privateKeyDownloadedAt?: Instant | null;
  readonly createdAt: Instant;
  readonly rotatedAt?: Instant | null;
  readonly revokedAt?: Instant | null;
}

export function createAdminKey(input: CreateAdminKeyInput): AdminKey {
  if (input.keyId.trim().length === 0) {
    throw invariantViolation('AdminKey keyId must be a non-empty string', { keyId: input.keyId });
  }
  if (input.publicKey.trim().length === 0) {
    throw invariantViolation('AdminKey publicKey must be a non-empty string', { publicKey: input.publicKey });
  }
  return {
    keyId: input.keyId,
    publicKey: input.publicKey,
    status: input.status,
    encryptedPrivateKey: input.encryptedPrivateKey,
    privateKeyDownloadedAt: input.privateKeyDownloadedAt ?? null,
    createdAt: input.createdAt,
    rotatedAt: input.rotatedAt ?? null,
    revokedAt: input.revokedAt ?? null,
  };
}

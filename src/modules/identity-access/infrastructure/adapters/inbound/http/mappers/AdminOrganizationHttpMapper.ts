import type { AdminOrganization } from '../../../../../domain/model/aggregates/AdminOrganization.js';
import type { AdminKey } from '../../../../../domain/model/value-objects/AdminKey.js';

/**
 * `encryptedPrivateKey` and `privateKeyDownloadedAt` are deliberately NOT in
 * this DTO (design D32: "private key persisted only as ciphertext... never
 * returned in response"). One-time download is a separate route (PR 2a),
 * not this one.
 */
export interface AdminKeyResponseDto {
  readonly keyId: string;
  readonly publicKey: string;
  readonly status: string;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
  readonly revokedAt: string | null;
}

export interface AdminOrganizationResponseDto {
  readonly id: string;
  readonly email: string;
  readonly keys: readonly AdminKeyResponseDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toAdminKeyResponse(key: AdminKey): AdminKeyResponseDto {
  return {
    keyId: key.keyId,
    publicKey: key.publicKey,
    status: key.status,
    createdAt: key.createdAt,
    rotatedAt: key.rotatedAt,
    revokedAt: key.revokedAt,
  };
}

export function toAdminOrganizationResponse(admin: AdminOrganization): AdminOrganizationResponseDto {
  return {
    id: admin.id,
    email: admin.email,
    keys: admin.keys.map(toAdminKeyResponse),
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}

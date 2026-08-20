import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { AdminOrganization } from '../../../../../domain/model/aggregates/AdminOrganization.js';
import { createAdminOrganizationId } from '../../../../../domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../../../../domain/model/value-objects/AdminKeyId.js';
import { createAdminKeyStatus } from '../../../../../domain/model/value-objects/AdminKeyStatus.js';
import { createAdminKey, type AdminKey } from '../../../../../domain/model/value-objects/AdminKey.js';
import { createEmail } from '../../../../../domain/model/value-objects/Email.js';
import type { AdminKeyDocument, AdminOrganizationDocument } from '../documents/AdminOrganizationDocument.js';

function keyToDocument(key: AdminKey): AdminKeyDocument {
  return {
    key_id: new ObjectId(key.keyId),
    public_key: key.publicKey,
    status: key.status,
    encrypted_private_key: key.encryptedPrivateKey,
    private_key_downloaded_at: key.privateKeyDownloadedAt === null ? null : toDate(key.privateKeyDownloadedAt),
    created_at: toDate(key.createdAt),
    rotated_at: key.rotatedAt === null ? null : toDate(key.rotatedAt),
    revoked_at: key.revokedAt === null ? null : toDate(key.revokedAt),
  };
}

function keyToDomain(document: AdminKeyDocument): AdminKey {
  return createAdminKey({
    keyId: createAdminKeyId(document.key_id.toString()),
    publicKey: document.public_key,
    status: createAdminKeyStatus(document.status),
    encryptedPrivateKey: document.encrypted_private_key,
    privateKeyDownloadedAt:
      document.private_key_downloaded_at === null ? null : fromDate(document.private_key_downloaded_at),
    createdAt: fromDate(document.created_at),
    rotatedAt: document.rotated_at === null ? null : fromDate(document.rotated_at),
    revokedAt: document.revoked_at === null ? null : fromDate(document.revoked_at),
  });
}

export function toDocument(admin: AdminOrganization): AdminOrganizationDocument {
  return {
    _id: new ObjectId(admin.id),
    email: admin.email,
    keys: admin.keys.map(keyToDocument),
    created_at: toDate(admin.createdAt),
    updated_at: toDate(admin.updatedAt),
  };
}

export function toDomain(document: AdminOrganizationDocument): AdminOrganization {
  return AdminOrganization.rehydrate({
    id: createAdminOrganizationId(document._id.toString()),
    email: createEmail(document.email),
    keys: document.keys.map(keyToDomain),
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

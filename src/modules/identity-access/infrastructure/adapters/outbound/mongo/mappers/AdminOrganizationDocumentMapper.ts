import { ObjectId } from 'mongodb';
import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { AdminOrganization } from '../../../../../domain/model/aggregates/AdminOrganization.js';
import { createAdminOrganizationId } from '../../../../../domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../../../../domain/model/value-objects/AdminKeyId.js';
import { createAdminKeyStatus } from '../../../../../domain/model/value-objects/AdminKeyStatus.js';
import { createAdminKey, type AdminKey } from '../../../../../domain/model/value-objects/AdminKey.js';
import { createEmail } from '../../../../../domain/model/value-objects/Email.js';
import type { AdminKeyDocument, AdminOrganizationDocument } from '../documents/AdminOrganizationDocument.js';

function keyToDocument(key: AdminKey): AdminKeyDocument {
  return {
    keyId: new ObjectId(key.keyId),
    publicKey: key.publicKey,
    status: key.status,
    encryptedPrivateKey: key.encryptedPrivateKey,
    privateKeyDownloadedAt: key.privateKeyDownloadedAt,
    createdAt: key.createdAt,
    rotatedAt: key.rotatedAt,
    revokedAt: key.revokedAt,
  };
}

function keyToDomain(document: AdminKeyDocument): AdminKey {
  return createAdminKey({
    keyId: createAdminKeyId(document.keyId.toString()),
    publicKey: document.publicKey,
    status: createAdminKeyStatus(document.status),
    encryptedPrivateKey: document.encryptedPrivateKey,
    privateKeyDownloadedAt:
      document.privateKeyDownloadedAt === null ? null : brand<string, 'Instant'>(document.privateKeyDownloadedAt),
    createdAt: brand<string, 'Instant'>(document.createdAt),
    rotatedAt: document.rotatedAt === null ? null : brand<string, 'Instant'>(document.rotatedAt),
    revokedAt: document.revokedAt === null ? null : brand<string, 'Instant'>(document.revokedAt),
  });
}

export function toDocument(admin: AdminOrganization): AdminOrganizationDocument {
  return {
    _id: new ObjectId(admin.id),
    email: admin.email,
    keys: admin.keys.map(keyToDocument),
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}

export function toDomain(document: AdminOrganizationDocument): AdminOrganization {
  return AdminOrganization.rehydrate({
    id: createAdminOrganizationId(document._id.toString()),
    email: createEmail(document.email),
    keys: document.keys.map(keyToDomain),
    createdAt: brand<string, 'Instant'>(document.createdAt),
    updatedAt: brand<string, 'Instant'>(document.updatedAt),
  });
}

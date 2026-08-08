import type { Instant } from '../../../../shared/time/Instant.js';
import type { AdminKeyPairGenerator } from '../../domain/ports/AdminKeyPairGenerator.js';
import type { SecretCipher } from '../../domain/ports/SecretCipher.js';
import type { AdminOrganizationId } from '../../domain/model/value-objects/AdminOrganizationId.js';
import type { AdminKeyId } from '../../domain/model/value-objects/AdminKeyId.js';
import { AdminOrganization } from '../../domain/model/aggregates/AdminOrganization.js';
import { createAdminKey } from '../../domain/model/value-objects/AdminKey.js';
import { createEmail } from '../../domain/model/value-objects/Email.js';

export interface ProvisionAdminOrganizationCoreDeps {
  readonly keyPairs: AdminKeyPairGenerator;
  readonly cipher: SecretCipher;
  readonly generateAdminOrganizationId: () => AdminOrganizationId;
  readonly generateAdminKeyId: () => AdminKeyId;
}

export interface ProvisionAdminOrganizationCoreInput {
  readonly email: string;
  readonly now: Instant;
}

export interface ProvisionAdminOrganizationCoreResult {
  readonly admin: AdminOrganization;
  /** Plaintext PKCS8 PEM — in-hand ONLY at this call site, before the caller decides how (or whether) to hand it to an operator. Never persisted. */
  readonly privateKeyPkcs8Pem: string;
}

/**
 * Pure provisioning core (design "Bootstrap script (admin #0)"): generates
 * a fresh Ed25519 keypair, encrypts the private key via `SecretCipher`, and
 * builds a brand-new `AdminOrganization` with exactly one `ACTIVE` key.
 * Deliberately does NOT save, audit, or authorize — those are the caller's
 * responsibility, so this same logic is reusable by both
 * `ProvisionAdminOrganization` (HTTP, `requirePlatformAdmin`-gated, wraps
 * this in a transaction) and the out-of-band bootstrap script (admin #0,
 * which has no `requirePlatformAdmin` to satisfy yet).
 */
export function provisionAdminOrganizationCore(
  deps: ProvisionAdminOrganizationCoreDeps,
  input: ProvisionAdminOrganizationCoreInput,
): ProvisionAdminOrganizationCoreResult {
  const { publicKeySpkiPem, privateKeyPkcs8Pem } = deps.keyPairs.generate();
  const encryptedPrivateKey = deps.cipher.encrypt(privateKeyPkcs8Pem);

  const key = createAdminKey({
    keyId: deps.generateAdminKeyId(),
    publicKey: publicKeySpkiPem,
    status: 'ACTIVE',
    encryptedPrivateKey,
    createdAt: input.now,
  });

  const admin = AdminOrganization.create({
    id: deps.generateAdminOrganizationId(),
    email: createEmail(input.email),
    keys: [key],
    now: input.now,
  });

  return { admin, privateKeyPkcs8Pem };
}

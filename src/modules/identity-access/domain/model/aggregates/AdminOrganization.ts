import type { Instant } from '../../../../../shared/time/Instant.js';
import type { AdminOrganizationId } from '../value-objects/AdminOrganizationId.js';
import type { AdminKeyId } from '../value-objects/AdminKeyId.js';
import type { AdminKey } from '../value-objects/AdminKey.js';
import type { Email } from '../value-objects/Email.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export interface AdminOrganizationProps {
  readonly id: AdminOrganizationId;
  readonly email: Email;
  readonly keys: readonly AdminKey[];
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateAdminOrganizationInput {
  readonly id: AdminOrganizationId;
  readonly email: Email;
  readonly keys: readonly AdminKey[];
  readonly now: Instant;
}

/**
 * Platform-level, tenant-less actor (design D31). Custody root for Ed25519
 * keys used in challenge-response auth — genuinely no password/MFA/lockout
 * fields, and deliberately no aggregate-level lifecycle `status`: revoking
 * the (at most one) `ACTIVE` key *is* deactivation, so a second status
 * column would just be a second, eventually-wrong, source of truth.
 *
 * Immutable, same shape as `Organization`/`User`: private ctor, `create`/
 * `rehydrate`, every mutator returns a brand-new instance.
 *
 * D31a: at-most-one-`ACTIVE` is an aggregate invariant, not a DB constraint
 * (a partial unique index cannot constrain elements *within* one document's
 * array). Asserted in `create`/`rotateKey`/`revokeKey`, and re-asserted by
 * the fail-closed `activeKey()` accessor, which throws rather than silently
 * picking one of two `ACTIVE` keys at the one call site that matters most
 * (challenge issuance). `rehydrate` stays validation-free, matching
 * `Organization.rehydrate`/`User.rehydrate`.
 */
export class AdminOrganization {
  private constructor(private readonly props: AdminOrganizationProps) {}

  static create(input: CreateAdminOrganizationInput): AdminOrganization {
    assertAtMostOneActive(input.keys);
    return new AdminOrganization({
      id: input.id,
      email: input.email,
      keys: input.keys,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: AdminOrganizationProps): AdminOrganization {
    return new AdminOrganization(props);
  }

  get id(): AdminOrganizationId {
    return this.props.id;
  }

  get email(): Email {
    return this.props.email;
  }

  get keys(): readonly AdminKey[] {
    return this.props.keys;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): AdminOrganizationProps {
    return this.props;
  }

  /**
   * Fail-closed read accessor (D31a). Returns the single `ACTIVE` key, or
   * `null` if none is active (e.g. every key deprecated/revoked). Throws
   * `INVARIANT_VIOLATION` if it ever finds more than one — a corrupt state
   * that must never be silently resolved by picking one.
   */
  activeKey(): AdminKey | null {
    const activeKeys = this.props.keys.filter((key) => key.status === 'ACTIVE');
    if (activeKeys.length > 1) {
      throw invariantViolation('AdminOrganization has more than one ACTIVE key', {
        id: this.props.id,
        activeKeyIds: activeKeys.map((key) => key.keyId),
      });
    }
    return activeKeys[0] ?? null;
  }

  findKey(keyId: AdminKeyId): AdminKey | null {
    return this.props.keys.find((key) => key.keyId === keyId) ?? null;
  }

  /**
   * Rotation (D33): demotes the current `ACTIVE` key(s) to `DEPRECATED`
   * (stamping `rotatedAt`) and appends `newKey`, which MUST already be
   * `ACTIVE`. Nothing is deleted — rotation history is the array itself.
   */
  rotateKey(newKey: AdminKey, now: Instant): AdminOrganization {
    if (newKey.status !== 'ACTIVE') {
      throw invariantViolation('AdminOrganization.rotateKey requires the new key to be ACTIVE', {
        keyId: newKey.keyId,
        status: newKey.status,
      });
    }
    const demoted = this.props.keys.map((key) =>
      key.status === 'ACTIVE' ? { ...key, status: 'DEPRECATED' as const, rotatedAt: now } : key,
    );
    const nextKeys = [...demoted, newKey];
    assertAtMostOneActive(nextKeys);
    return new AdminOrganization({ ...this.props, keys: nextKeys, updatedAt: now });
  }

  /**
   * Revocation (D33): marks `keyId` `REVOKED`, terminal — a key that is
   * already `REVOKED` cannot be revoked again. Session cascade (D40) is the
   * caller's responsibility (same `withTransaction`), not this method's.
   */
  revokeKey(keyId: AdminKeyId, now: Instant): AdminOrganization {
    const key = this.findKey(keyId);
    if (key === null) {
      throw invariantViolation('AdminOrganization.revokeKey: no key with this id', { keyId });
    }
    if (key.status === 'REVOKED') {
      throw invariantViolation('AdminOrganization.revokeKey: key is already REVOKED (terminal)', { keyId });
    }
    const nextKeys = this.props.keys.map((k) =>
      k.keyId === keyId ? { ...k, status: 'REVOKED' as const, revokedAt: now } : k,
    );
    return new AdminOrganization({ ...this.props, keys: nextKeys, updatedAt: now });
  }

  /**
   * One-time private key download (D32a). This mirrors, at the aggregate
   * level, the atomic `findOneAndUpdate` the repository performs — it is
   * used to keep an in-memory/rehydrated aggregate consistent with a claim
   * that already happened, not to perform the claim itself (the CAS is the
   * source of truth for concurrency).
   */
  markPrivateKeyDownloaded(keyId: AdminKeyId, now: Instant): AdminOrganization {
    const key = this.findKey(keyId);
    if (key === null) {
      throw invariantViolation('AdminOrganization.markPrivateKeyDownloaded: no key with this id', { keyId });
    }
    if (key.privateKeyDownloadedAt !== null) {
      throw invariantViolation(
        'AdminOrganization.markPrivateKeyDownloaded: private key was already downloaded',
        { keyId },
      );
    }
    const nextKeys = this.props.keys.map((k) =>
      k.keyId === keyId ? { ...k, privateKeyDownloadedAt: now, encryptedPrivateKey: null } : k,
    );
    return new AdminOrganization({ ...this.props, keys: nextKeys, updatedAt: now });
  }
}

function assertAtMostOneActive(keys: readonly AdminKey[]): void {
  const activeCount = keys.filter((key) => key.status === 'ACTIVE').length;
  if (activeCount > 1) {
    throw invariantViolation('AdminOrganization must have at most one ACTIVE key', { activeCount });
  }
}

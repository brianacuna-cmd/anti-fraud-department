import type { AdminOrganization } from '../model/aggregates/AdminOrganization.js';
import type { AdminOrganizationId } from '../model/value-objects/AdminOrganizationId.js';
import type { AdminKeyId } from '../model/value-objects/AdminKeyId.js';
import type { Email } from '../model/value-objects/Email.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for the `AdminOrganization` aggregate (design D31/D32a).
 *
 * `countAll` backs the D43c bootstrap-script guard (`countAll() > 0` refuses
 * a second bootstrap run) — returns an exact count, not merely a boolean.
 */
export interface AdminOrganizationRepository {
  save(admin: AdminOrganization, tx?: Transaction): Promise<void>;
  findById(id: AdminOrganizationId): Promise<AdminOrganization | null>;
  findByEmail(email: Email): Promise<AdminOrganization | null>;
  countAll(): Promise<number>;

  /**
   * Atomic one-time-download claim (design D32a, PR 2a): a `findOneAndUpdate`
   * that only matches a document whose `keyId` element still holds a
   * non-null `encryptedPrivateKey`, and in the SAME operation nulls it out
   * and stamps `privateKeyDownloadedAt`. Returns the ciphertext that was
   * there BEFORE the update to exactly ONE winning concurrent caller — every
   * other concurrent/subsequent caller (including a genuinely-missing
   * admin/key) gets `null`. Mirrors `MongoSessionRepository.markRotated`'s
   * CAS shape, but returns the claimed value instead of a boolean because
   * the caller needs the ciphertext to decrypt, not just a yes/no.
   */
  claimPrivateKey(
    id: AdminOrganizationId,
    keyId: AdminKeyId,
    now: Instant,
    tx?: Transaction,
  ): Promise<string | null>;
}

import { AdminOrganization } from '../../../src/modules/identity-access/domain/model/aggregates/AdminOrganization.js';
import type { AdminOrganizationRepository } from '../../../src/modules/identity-access/domain/ports/AdminOrganizationRepository.js';
import type { AdminOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import type { AdminKeyId } from '../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import type { Email } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import type { Instant } from '../../../src/shared/time/Instant.js';

/**
 * In-memory `AdminOrganizationRepository` fake (design Testing Strategy:
 * "in-memory fakes for ports"). `claimPrivateKey` (design D32a) reproduces
 * the Mongo adapter's atomic-claim semantics: only the key's own
 * `encryptedPrivateKey`/`privateKeyDownloadedAt` are mutated (mirrors the
 * Mongo positional `$set`), and — since Node is single-threaded — a plain
 * synchronous check-then-set is already race-free for `Promise.all`-style
 * concurrent callers awaiting the same microtask queue.
 */
export class InMemoryAdminOrganizationRepository implements AdminOrganizationRepository {
  private readonly byId = new Map<string, AdminOrganization>();

  async save(admin: AdminOrganization): Promise<void> {
    this.byId.set(admin.id, admin);
  }

  async findById(id: AdminOrganizationId): Promise<AdminOrganization | null> {
    return this.byId.get(id) ?? null;
  }

  async findByEmail(email: Email): Promise<AdminOrganization | null> {
    for (const admin of this.byId.values()) {
      if ((admin.email as string) === (email as string)) {
        return admin;
      }
    }
    return null;
  }

  async countAll(): Promise<number> {
    return this.byId.size;
  }

  async claimPrivateKey(id: AdminOrganizationId, keyId: AdminKeyId, now: Instant): Promise<string | null> {
    const admin = this.byId.get(id);
    if (!admin) {
      return null;
    }
    const key = admin.findKey(keyId);
    if (!key || key.encryptedPrivateKey === null) {
      return null;
    }
    const claimed = key.encryptedPrivateKey;
    this.byId.set(id, admin.markPrivateKeyDownloaded(keyId, now));
    return claimed;
  }
}

import { AdminOrganization } from '../../../src/modules/identity-access/domain/model/aggregates/AdminOrganization.js';
import type { AdminOrganizationRepository } from '../../../src/modules/identity-access/domain/ports/AdminOrganizationRepository.js';
import type { AdminOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import type { Email } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';

/**
 * In-memory `AdminOrganizationRepository` fake — PR 1b scope only (design
 * Testing Strategy: "in-memory fakes for ports"). The `claimPrivateKey` CAS
 * (design D32a) is NOT implemented here yet: it lands in PR 2a, where this
 * fake must reproduce the same atomic-claim semantics the Mongo adapter
 * uses, not just plain storage.
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
}

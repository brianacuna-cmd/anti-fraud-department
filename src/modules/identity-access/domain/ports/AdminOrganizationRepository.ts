import type { AdminOrganization } from '../model/aggregates/AdminOrganization.js';
import type { AdminOrganizationId } from '../model/value-objects/AdminOrganizationId.js';
import type { Email } from '../model/value-objects/Email.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for the `AdminOrganization` aggregate (design D31/D32a).
 *
 * PR 1b scope only: `save`/`findById`/`findByEmail`/`countAll`. The atomic
 * `claimPrivateKey` CAS (design D32a) is added in PR 2a, alongside its
 * concurrency-tested implementation — deliberately not declared here yet.
 *
 * `countAll` backs the D43c bootstrap-script guard (`countAll() > 0` refuses
 * a second bootstrap run) — returns an exact count, not merely a boolean.
 */
export interface AdminOrganizationRepository {
  save(admin: AdminOrganization, tx?: Transaction): Promise<void>;
  findById(id: AdminOrganizationId): Promise<AdminOrganization | null>;
  findByEmail(email: Email): Promise<AdminOrganization | null>;
  countAll(): Promise<number>;
}

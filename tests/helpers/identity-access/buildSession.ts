import { Session } from '../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createSessionId } from '../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createAdminOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { fromDate, type Instant } from '../../../src/shared/time/Instant.js';
import { oid } from '../../support/oid.js';

const DEFAULT_NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

export function buildSession(overrides: {
  id?: string;
  userId?: string | null;
  organizationId?: string | null;
  adminOrganizationId?: string | null;
  tokenHash?: string;
  expiresAt?: Instant;
  ipAddress?: string | null;
  userAgent?: string | null;
  now?: Instant;
  deletedAt?: Instant | null;
} = {}): Session {
  const id = createSessionId(overrides.id ?? oid('session-1'));
  const adminOrganizationId =
    overrides.adminOrganizationId == null ? null : createAdminOrganizationId(overrides.adminOrganizationId);

  const userId = adminOrganizationId
    ? null
    : overrides.userId === undefined
      ? oid('user-1')
      : overrides.userId;
  const organizationId = adminOrganizationId
    ? null
    : overrides.organizationId === undefined
      ? createOrganizationId(oid('org-1'))
      : overrides.organizationId === null
        ? null
        : createOrganizationId(overrides.organizationId);

  const now = overrides.now ?? DEFAULT_NOW;
  const session = Session.create({
    id,
    userId,
    organizationId,
    adminOrganizationId,
    tokenHash: overrides.tokenHash ?? `token-hash-${id}`,
    expiresAt: overrides.expiresAt ?? now,
    ipAddress: overrides.ipAddress ?? null,
    userAgent: overrides.userAgent ?? null,
    now,
  });

  if (overrides.deletedAt == null) {
    return session;
  }
  return Session.rehydrate({ ...session.toProps(), deletedAt: overrides.deletedAt });
}

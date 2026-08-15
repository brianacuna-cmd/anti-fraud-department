import { createAuthContext, type AuthContext } from '../../../shared/kernel/AuthContext.js';

/**
 * System actor for post-ACK score→case (design D8). HTTP webhook path
 * must not use caller JWT. Composition (PR5) consumes this helper.
 */
export function createIngestSystemAuthContext(organizationId: string, provider: string): AuthContext {
  return createAuthContext({
    userId: `system:ingest:${provider}`,
    organizationId,
    actorType: 'ORGANIZATION',
    purpose: 'full',
    roleId: null,
  });
}

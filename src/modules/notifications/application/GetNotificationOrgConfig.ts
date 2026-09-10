import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { NotificationOrgConfigRepository } from '../domain/ports/NotificationOrgConfigRepository.js';
import { NotificationOrgConfig } from '../domain/model/aggregates/NotificationOrgConfig.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { generateNotificationOrgConfigId } from '../domain/model/value-objects/NotificationOrgConfigId.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface GetNotificationOrgConfigInput {
  readonly auth: AuthContext;
}

export interface GetNotificationOrgConfigDeps {
  readonly repository: NotificationOrgConfigRepository;
  readonly clock: Clock;
}

/**
 * Gated by `SUPERVISION_ROLES` (spec Req 1 scenario 4), same as the PUT
 * side. ADR-6: GET never 404s — when no row exists yet, returns a
 * default/empty in-memory representation (`webhookUrl: null`) rather than
 * throwing, unlike `GetOrganizationFraudConfig`.
 */
export function createGetNotificationOrgConfigUseCase(deps: GetNotificationOrgConfigDeps) {
  return async function getNotificationOrgConfig(
    input: GetNotificationOrgConfigInput,
  ): Promise<NotificationOrgConfig> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = createOrganizationId(requireTenantContext(input.auth));

    const existing = await deps.repository.findByOrganization(organizationId);
    if (existing) {
      return existing;
    }

    const now = deps.clock.now();
    return NotificationOrgConfig.create({
      id: generateNotificationOrgConfigId(),
      organizationId,
      webhookUrl: null,
      secret: null,
      now,
    });
  };
}

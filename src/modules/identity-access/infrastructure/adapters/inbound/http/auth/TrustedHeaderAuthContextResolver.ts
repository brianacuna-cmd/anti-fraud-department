import type { Request } from 'express';
import type { AuthContext } from '../../../../../../../shared/kernel/AuthContext.js';
import { createAuthContext } from '../../../../../../../shared/kernel/AuthContext.js';
import { ROLE_SUPERVISOR } from '../../../../../../../shared/kernel/AccessTier.js';
import type { AuthContextResolver } from './AuthContextResolver.js';

const USER_ID_HEADER = 'x-actor-user-id';
const ORGANIZATION_ID_HEADER = 'x-actor-organization-id';
const IS_PLATFORM_ADMIN_HEADER = 'x-actor-is-platform-admin';
const ROLE_ID_HEADER = 'x-actor-role-id';

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Dev/staging-only `AuthContextResolver` that trusts `x-actor-*` headers
 * verbatim (design D4) — enabled only when `AUTH_MODE=trusted-header`, and
 * `assertAuthConfigSafeForProduction` refuses to let that mode start in
 * production. A real session-backed resolver replaces this later (design
 * D12). `resolve` needs no I/O here but still returns a `Promise` to match
 * the shared `AuthContextResolver` signature.
 *
 * `x-actor-organization-id` is now optional (design D11): when absent, the
 * resolved `organizationId` is `null` — this lets a dev/staging caller
 * simulate a platform administrator, who has no organization, without a
 * sentinel value.
 */
export class TrustedHeaderAuthContextResolver implements AuthContextResolver {
  async resolve(req: Request): Promise<AuthContext | null> {
    const userId = headerValue(req, USER_ID_HEADER);
    if (!userId) {
      return null;
    }

    const isPlatformAdmin = headerValue(req, IS_PLATFORM_ADMIN_HEADER) === 'true';
    const requestedRole = headerValue(req, ROLE_ID_HEADER);
    return createAuthContext({
      userId,
      organizationId: headerValue(req, ORGANIZATION_ID_HEADER) ?? null,
      isPlatformAdmin,
      // Demo frontend has no session/role catalog: USER trusted-header
      // defaults to SUPERVISOR so fraud-config/rules/ingest are not 403
      // `role "null"`. PLATFORM_ADMIN stays role-less. Override with
      // `x-actor-role-id` when a test needs ANALYST/ADMIN/AUDITOR.
      roleId: isPlatformAdmin ? null : (requestedRole ?? ROLE_SUPERVISOR),
    });
  }
}

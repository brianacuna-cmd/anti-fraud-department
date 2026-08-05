import type { Request } from 'express';
import type { AuthContext } from '../../../../../../../shared/kernel/AuthContext.js';
import { createAuthContext } from '../../../../../../../shared/kernel/AuthContext.js';
import type { AuthContextResolver } from './AuthContextResolver.js';

const USER_ID_HEADER = 'x-actor-user-id';
const ORGANIZATION_ID_HEADER = 'x-actor-organization-id';
const IS_PLATFORM_ADMIN_HEADER = 'x-actor-is-platform-admin';

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Dev/staging-only `AuthContextResolver` that trusts `x-actor-*` headers
 * verbatim (design D4) — enabled only when `AUTH_MODE=trusted-header`, and
 * `assertAuthModeSafeForProduction` refuses to let that mode start in
 * production. A real JWT-verifying resolver replaces this later.
 */
export class TrustedHeaderAuthContextResolver implements AuthContextResolver {
  resolve(req: Request): AuthContext | null {
    const userId = headerValue(req, USER_ID_HEADER);
    const organizationId = headerValue(req, ORGANIZATION_ID_HEADER);
    if (!userId || !organizationId) {
      return null;
    }

    return createAuthContext({
      userId,
      organizationId,
      isPlatformAdmin: headerValue(req, IS_PLATFORM_ADMIN_HEADER) === 'true',
    });
  }
}

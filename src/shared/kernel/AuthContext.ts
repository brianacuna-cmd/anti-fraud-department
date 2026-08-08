/**
 * The kind of actor an `AuthContext` was resolved for (design D11). Kept as
 * a plain string union directly in `shared/kernel` rather than importing
 * `identity-access`'s domain VO: `shared` may not depend on any module
 * (eslint `boundaries`), and every actor tier this kernel type needs to
 * express is already enumerable here.
 */
export type ActorType = 'USER' | 'ORGANIZATION' | 'PLATFORM_ADMIN';

/**
 * The authenticated caller for the current request, resolved by whichever
 * `AuthContextResolver` is active (design D4, D12). Real session-backed
 * resolution later swaps the resolver only — the shape stays the same.
 *
 * `organizationId` is `string | null` (design D11): a platform administrator
 * acts with no tenant context, and a non-null sentinel value would silently
 * satisfy tenant filters — a cross-tenant leak. Every tenant-scoped read
 * MUST route through `requireTenantContext` to narrow it back to `string`.
 */
export interface AuthContext {
  readonly userId: string;
  readonly organizationId: string | null;
  readonly isPlatformAdmin: boolean;
  readonly actorType: ActorType;
  readonly roleId: string | null;
  readonly sessionId: string | null;
  /**
   * The caller's IP address, sourced from `req.ip` via `authContextMiddleware`
   * (design D-A7/§4a) — `null` when unresolved (e.g. no upstream middleware
   * populated it, or `req.ip` itself is unavailable).
   */
  readonly ipAddress: string | null;
}

export interface CreateAuthContextInput {
  readonly userId: string;
  readonly organizationId: string | null;
  readonly isPlatformAdmin?: boolean;
  readonly actorType?: ActorType;
  readonly roleId?: string | null;
  readonly sessionId?: string | null;
  readonly ipAddress?: string | null;
}

/**
 * `isPlatformAdmin` absent => `false` (design: additive, optional field).
 *
 * `actorType` absent => derived from `isPlatformAdmin` (`'PLATFORM_ADMIN'` or
 * `'USER'`) so every pre-D11 call site — dozens of test fixtures and
 * `TrustedHeaderAuthContextResolver` — keeps working unchanged even though
 * `requirePlatformAdmin` now reads `actorType`, never `isPlatformAdmin`,
 * directly (design D11/D12).
 *
 * `roleId`/`sessionId` absent => `null` (design D11 — populated once
 * `Roles`/`Sessions` exist, in later phases of this change).
 *
 * `ipAddress` absent => `null` (design D-A7 — additive, optional field;
 * every pre-existing call site keeps working unchanged).
 */
export function createAuthContext(input: CreateAuthContextInput): AuthContext {
  const isPlatformAdmin = input.isPlatformAdmin ?? false;
  return {
    userId: input.userId,
    organizationId: input.organizationId,
    isPlatformAdmin,
    actorType: input.actorType ?? (isPlatformAdmin ? 'PLATFORM_ADMIN' : 'USER'),
    roleId: input.roleId ?? null,
    sessionId: input.sessionId ?? null,
    ipAddress: input.ipAddress ?? null,
  };
}

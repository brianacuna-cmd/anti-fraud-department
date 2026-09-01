import type { Request } from 'express';
import type { AuthContext } from '../../../../../../../shared/kernel/AuthContext.js';
import type { AuthContextResolver } from './AuthContextResolver.js';
import { TrustedHeaderAuthContextResolver } from './TrustedHeaderAuthContextResolver.js';
import { SessionTokenAuthContextResolver } from './SessionTokenAuthContextResolver.js';
import {
  AgentApiKeyAuthContextResolver,
  agentApiKeyHeaderPresent,
} from './AgentApiKeyAuthContextResolver.js';
import type { SessionTokenService } from '../../../../../domain/ports/SessionTokenService.js';
import type { SessionRepository } from '../../../../../domain/ports/SessionRepository.js';
import type { UserRepositoryFactory } from '../../../../../domain/ports/UserRepositoryFactory.js';
import type { AgentApiKeyRepository } from '../../../../../domain/ports/AgentApiKeyRepository.js';

const TRUSTED_HEADER_MODE = 'trusted-header';
const SESSION_MODE = 'session';
const PLATFORM_ADMIN_AUTH_TRUSTED_HEADER = 'trusted-header';

/** Only consulted for `AUTH_MODE=session` (design D6/D12) — every other mode ignores these. */
export interface AuthContextResolverDeps {
  readonly sessionTokenService?: SessionTokenService;
  readonly sessionRepository?: SessionRepository;
  /** Resolves the user's role on every request, to populate `AuthContext.roleId`. */
  readonly userRepositoryFactory?: UserRepositoryFactory;
  /**
   * Design D6: `'disabled'` (default, prod-safe) or `'trusted-header'`
   * (non-prod-only, interim PLATFORM_ADMIN path — `assertAuthConfigSafeForProduction`
   * refuses to let it start in production). Absent/anything else behaves as
   * `'disabled'`.
   */
  readonly platformAdminAuth?: string;
  readonly agentApiKeyRepository?: AgentApiKeyRepository;
}

/** AUTH_MODE selector. Session: Bearer, then X-Agent-Api-Key, then opt-in admin. */
export function resolveAuthContextResolver(
  authMode: string,
  deps: AuthContextResolverDeps = {},
): AuthContextResolver {
  if (authMode === TRUSTED_HEADER_MODE) {
    return new TrustedHeaderAuthContextResolver();
  }
  if (authMode === SESSION_MODE) {
    if (!deps.sessionTokenService || !deps.sessionRepository) {
      throw new Error(
        `AUTH_MODE=${SESSION_MODE} requires both a sessionTokenService and a sessionRepository dependency.`,
      );
    }
    if (!deps.userRepositoryFactory) {
      // Sin el, `roleId` seria siempre null y todas las guardas de rol
      // rechazarian: mejor no arrancar que servir un 403 permanente.
      throw new Error('AUTH_MODE=session requires userRepositoryFactory to resolve the caller role');
    }
    const session = new SessionTokenAuthContextResolver(
      deps.sessionTokenService,
      deps.sessionRepository,
      deps.userRepositoryFactory,
    );
    const agent = new AgentApiKeyAuthContextResolver(deps.agentApiKeyRepository ?? null);
    const adminInterim =
      deps.platformAdminAuth === PLATFORM_ADMIN_AUTH_TRUSTED_HEADER ? new TrustedHeaderAuthContextResolver() : null;
    return new SessionAgentAuthContextResolver(session, agent, adminInterim);
  }
  throw new Error(
    `Unsupported AUTH_MODE "${authMode}": only "${TRUSTED_HEADER_MODE}" or "${SESSION_MODE}" is currently supported.`,
  );
}

const PLATFORM_ADMIN = 'PLATFORM_ADMIN';

/** Session → agent header (no admin fallthrough) → opt-in PLATFORM_ADMIN. */
export class SessionAgentAuthContextResolver implements AuthContextResolver {
  constructor(
    private readonly session: AuthContextResolver,
    private readonly agent: AuthContextResolver,
    private readonly adminInterim: AuthContextResolver | null,
  ) {}

  async resolve(req: Request): Promise<AuthContext | null> {
    const sessionContext = await this.session.resolve(req);
    if (sessionContext) {
      return sessionContext;
    }
    if (agentApiKeyHeaderPresent(req)) {
      return this.agent.resolve(req);
    }
    if (!this.adminInterim) {
      return null;
    }
    const adminContext = await this.adminInterim.resolve(req);
    return adminContext?.actorType === PLATFORM_ADMIN ? adminContext : null;
  }
}

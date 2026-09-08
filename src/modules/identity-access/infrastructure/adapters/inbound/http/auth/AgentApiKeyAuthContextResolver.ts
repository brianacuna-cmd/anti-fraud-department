import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { AuthContext } from '../../../../../../../shared/kernel/AuthContext.js';
import { createAuthContext, SYSTEM_AGENT_USER_ID } from '../../../../../../../shared/kernel/AuthContext.js';
import { ROLE_ANALYST } from '../../../../../../../shared/kernel/AccessTier.js';
import type { AuthContextResolver } from './AuthContextResolver.js';
import type { AgentApiKeyRepository } from '../../../../../domain/ports/AgentApiKeyRepository.js';

const HEADER = 'x-agent-api-key';

export function agentApiKeyHeaderPresent(req: Request): boolean {
  return req.headers[HEADER] !== undefined;
}

export class AgentApiKeyAuthContextResolver implements AuthContextResolver {
  constructor(private readonly agentApiKeys: AgentApiKeyRepository | null) {}

  async resolve(req: Request): Promise<AuthContext | null> {
    const raw = req.headers[HEADER];
    const plaintext = typeof raw === 'string' && raw.length > 0 ? raw : null;
    if (!plaintext || !this.agentApiKeys) {
      return null;
    }
    const key = await this.agentApiKeys.findBySecretHash(createHash('sha256').update(plaintext, 'utf8').digest('hex'));
    if (!key || key.status !== 'ACTIVE') {
      return null;
    }
    return createAuthContext({
      userId: SYSTEM_AGENT_USER_ID,
      organizationId: key.organizationId,
      actorType: 'USER',
      roleId: ROLE_ANALYST,
    });
  }
}

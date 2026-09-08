import { createHash, randomBytes } from 'node:crypto';
import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import { AgentApiKey, type AgentApiKeyId } from '../domain/model/aggregates/AgentApiKey.js';
import type { AgentApiKeyRepository } from '../domain/ports/AgentApiKeyRepository.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOrganizationActor } from './authorization/requireOrganizationActor.js';

export function createCreateAgentApiKeyUseCase(deps: {
  readonly agentApiKeys: AgentApiKeyRepository;
  readonly generateId: () => AgentApiKeyId;
}) {
  return async function createAgentApiKey(input: { readonly auth: AuthContext }): Promise<{
    readonly keyId: AgentApiKeyId;
    readonly plaintext: string;
  }> {
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    requireOrganizationActor(input.auth);
    const plaintext = randomBytes(32).toString('hex');
    const key = AgentApiKey.create({
      id: deps.generateId(),
      secretHash: createHash('sha256').update(plaintext, 'utf8').digest('hex'),
      organizationId,
    });
    await deps.agentApiKeys.save(key);
    return { keyId: key.id, plaintext };
  };
}

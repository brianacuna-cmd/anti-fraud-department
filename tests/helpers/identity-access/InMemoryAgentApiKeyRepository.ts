import { AgentApiKey } from '../../../src/modules/identity-access/domain/model/aggregates/AgentApiKey.js';
import type { AgentApiKeyRepository } from '../../../src/modules/identity-access/domain/ports/AgentApiKeyRepository.js';

export class InMemoryAgentApiKeyRepository implements AgentApiKeyRepository {
  private readonly byHash = new Map<string, AgentApiKey>();
  async save(key: AgentApiKey): Promise<void> { this.byHash.set(key.secretHash, key); }
  async findBySecretHash(hash: string): Promise<AgentApiKey | null> { return this.byHash.get(hash) ?? null; }
}

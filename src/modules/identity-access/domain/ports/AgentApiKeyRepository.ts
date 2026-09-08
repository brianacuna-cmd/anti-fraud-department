import type { AgentApiKey } from '../model/aggregates/AgentApiKey.js';

export interface AgentApiKeyRepository {
  save(key: AgentApiKey): Promise<void>;
  findBySecretHash(hash: string): Promise<AgentApiKey | null>;
}

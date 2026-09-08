import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';
import type { OrganizationId } from '../value-objects/OrganizationId.js';

export type AgentApiKeyId = Brand<string, 'AgentApiKeyId'>;
export type AgentApiKeyStatus = 'ACTIVE' | 'REVOKED';

export function createAgentApiKeyId(value: string): AgentApiKeyId {
  if (!isObjectIdHex(value)) throw invariantViolation('AgentApiKeyId must be a 24-character hexadecimal ObjectId', { value });
  return brand<string, 'AgentApiKeyId'>(value);
}

export class AgentApiKey {
  private constructor(
    readonly id: AgentApiKeyId,
    readonly secretHash: string,
    readonly organizationId: OrganizationId,
    readonly status: AgentApiKeyStatus,
  ) {}

  static create(input: { id: AgentApiKeyId; secretHash: string; organizationId: OrganizationId }): AgentApiKey {
    return new AgentApiKey(input.id, input.secretHash, input.organizationId, 'ACTIVE');
  }

  static rehydrate(input: {
    id: AgentApiKeyId; secretHash: string; organizationId: OrganizationId; status: AgentApiKeyStatus;
  }): AgentApiKey {
    return new AgentApiKey(input.id, input.secretHash, input.organizationId, input.status);
  }
}

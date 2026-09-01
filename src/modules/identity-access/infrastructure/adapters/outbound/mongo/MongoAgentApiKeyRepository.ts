import { ObjectId, type Collection, type Db } from 'mongodb';
import { AgentApiKey, createAgentApiKeyId } from '../../../../domain/model/aggregates/AgentApiKey.js';
import { createOrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import type { AgentApiKeyRepository } from '../../../../domain/ports/AgentApiKeyRepository.js';

interface AgentApiKeyDocument {
  readonly _id: ObjectId;
  readonly secret_hash: string;
  readonly organization_id: ObjectId;
  readonly status: 'ACTIVE' | 'REVOKED';
}

export class MongoAgentApiKeyRepository implements AgentApiKeyRepository {
  private readonly collection: Collection<AgentApiKeyDocument>;
  constructor(db: Db) {
    this.collection = db.collection('agent_api_keys');
  }

  async save(key: AgentApiKey): Promise<void> {
    const document: AgentApiKeyDocument = {
      _id: new ObjectId(key.id),
      secret_hash: key.secretHash,
      organization_id: new ObjectId(key.organizationId),
      status: key.status,
    };
    await this.collection.replaceOne({ _id: document._id }, document, { upsert: true });
  }

  async findBySecretHash(hash: string): Promise<AgentApiKey | null> {
    const document = await this.collection.findOne({ secret_hash: hash });
    return document
      ? AgentApiKey.rehydrate({
          id: createAgentApiKeyId(document._id.toString()),
          secretHash: document.secret_hash,
          organizationId: createOrganizationId(document.organization_id.toString()),
          status: document.status,
        })
      : null;
  }
}

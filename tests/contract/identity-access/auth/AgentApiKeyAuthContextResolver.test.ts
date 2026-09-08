import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { oid } from '../../../support/oid.js';
import { AgentApiKeyAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/AgentApiKeyAuthContextResolver.js';
import { AgentApiKey, createAgentApiKeyId } from '../../../../src/modules/identity-access/domain/model/aggregates/AgentApiKey.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { InMemoryAgentApiKeyRepository } from '../../../helpers/identity-access/InMemoryAgentApiKeyRepository.js';
import { createAuthContext, SYSTEM_AGENT_USER_ID } from '../../../../src/shared/kernel/AuthContext.js';
import { requireAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { UnauthenticatedError } from '../../../../src/shared/kernel/UnauthenticatedError.js';
import { createCreateAgentApiKeyUseCase } from '../../../../src/modules/identity-access/application/CreateAgentApiKey.js';

const sha256 = (p: string) => createHash('sha256').update(p, 'utf8').digest('hex');
const req = (key?: string) => ({ headers: key === undefined ? {} : { 'x-agent-api-key': key } }) as Request;
const org = createOrganizationId(oid('org-1'));

async function seed(repo: InMemoryAgentApiKeyRepository, key: string, status: 'ACTIVE' | 'REVOKED' = 'ACTIVE') {
  const props = { id: createAgentApiKeyId(oid(key)), secretHash: sha256(key), organizationId: org };
  await repo.save(status === 'ACTIVE' ? AgentApiKey.create(props) : AgentApiKey.rehydrate({ ...props, status }));
}

describe('AgentApiKeyAuthContextResolver', () => {
  it('resolves a valid ACTIVE key as USER / system:agent / ANALYST / purpose full', async () => {
    const repo = new InMemoryAgentApiKeyRepository();
    await seed(repo, 'a'.repeat(64));
    expect(await new AgentApiKeyAuthContextResolver(repo).resolve(req('a'.repeat(64)))).toMatchObject({
      actorType: 'USER', userId: SYSTEM_AGENT_USER_ID, roleId: 'ANALYST', purpose: 'full',
      organizationId: oid('org-1'), sessionId: null, isPlatformAdmin: false,
    });
  });

  it('returns null for a bad key so requireAuthContext is 401, and for REVOKED hashes', async () => {
    const request = req('not-a-stored-key');
    expect(await new AgentApiKeyAuthContextResolver(new InMemoryAgentApiKeyRepository()).resolve(request)).toBeNull();
    expect(() => requireAuthContext(request)).toThrow(UnauthenticatedError);
    const repo = new InMemoryAgentApiKeyRepository();
    await seed(repo, 'c'.repeat(64), 'REVOKED');
    expect(await new AgentApiKeyAuthContextResolver(repo).resolve(req('c'.repeat(64)))).toBeNull();
  });
});

describe('createCreateAgentApiKeyUseCase', () => {
  const useCase = (repo: InMemoryAgentApiKeyRepository) =>
    createCreateAgentApiKeyUseCase({ agentApiKeys: repo, generateId: () => createAgentApiKeyId(oid('key-1')) });

  it('ORGANIZATION actor persists sha256 hash and returns plaintext once', async () => {
    const repo = new InMemoryAgentApiKeyRepository();
    const result = await useCase(repo)({
      auth: createAuthContext({ userId: oid('org-actor'), organizationId: oid('org-1'), actorType: 'ORGANIZATION' }),
    });
    expect(result).toEqual({ keyId: oid('key-1'), plaintext: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect((await repo.findBySecretHash(sha256(result.plaintext)))?.status).toBe('ACTIVE');
  });

  it('rejects a USER actor as forbidden and writes nothing', async () => {
    const repo = new InMemoryAgentApiKeyRepository();
    await expect(
      useCase(repo)({ auth: createAuthContext({ userId: oid('u1'), organizationId: oid('org-1'), actorType: 'USER', roleId: 'ADMIN' }) }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
    expect(await repo.findBySecretHash('x')).toBeNull();
  });
});

import {
  toUserResponse,
  toUserListResponse,
} from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/mappers/UserHttpMapper.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildUser(id: string, middleName: string | null = null): User {
  return User.create({
    id: createUserId(id),
    organizationId: createOrganizationId('org-1'),
    email: createEmail(`${id}@example.com`),
    credential: createPasswordCredential('hash-value'),
    firstName: 'First',
    middleName,
    lastName: 'Last',
    now: NOW,
  });
}

describe('toUserResponse', () => {
  it('maps a User aggregate to a plain JSON-serializable DTO, excluding the password credential', () => {
    const user = buildUser('user-1');

    const dto = toUserResponse(user);

    expect(dto).toEqual({
      id: 'user-1',
      organizationId: 'org-1',
      email: 'user-1@example.com',
      firstName: 'First',
      middleName: null,
      lastName: 'Last',
      avatarUrl: null,
      status: 'ACTIVE',
      isPlatformAdmin: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(dto).not.toHaveProperty('passwordHash');
    expect(dto).not.toHaveProperty('passwordSalt');
    expect(dto).not.toHaveProperty('credential');
  });

  it('surfaces a provided middleName (design A12 — exposed on HTTP, camelCase)', () => {
    const user = buildUser('user-2', 'Danger');

    const dto = toUserResponse(user);

    expect(dto.middleName).toBe('Danger');
  });

  it('excludes resetToken, mfa, and configuration — persistence/domain-only, never on a DTO (design A11)', () => {
    const user = buildUser('user-1');

    const dto = toUserResponse(user);

    expect(dto).not.toHaveProperty('resetToken');
    expect(dto).not.toHaveProperty('mfa');
    expect(dto).not.toHaveProperty('configuration');
  });
});

describe('toUserListResponse', () => {
  it('maps a cursor page of users to {items, nextCursor}', () => {
    const page = { items: [buildUser('user-1'), buildUser('user-2')], nextCursor: 'user-2' };

    const dto = toUserListResponse(page);

    expect(dto.items).toHaveLength(2);
    expect(dto.items[0]?.id).toBe('user-1');
    expect(dto.nextCursor).toBe('user-2');
  });
});

import { oid } from '../../../../support/oid.js';
import { createSessionIssuer } from '../../../../../src/modules/identity-access/application/auth/SessionIssuer.js';
import { InMemorySessionRepository } from '../../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUnitOfWork } from '../../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { AesGcmSessionTokenService } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { AesGcmSecretCipher } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { createOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createAdminOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_ID = createOrganizationId(oid('org-1'));
const ADMIN_ID = createAdminOrganizationId(oid('admin-1'));
const TOKEN_SERVICE = new AesGcmSessionTokenService(new AesGcmSecretCipher('test-secret', 1));

function buildIssuer(sessions: InMemorySessionRepository) {
  return createSessionIssuer({
    sessionTokenService: TOKEN_SERVICE,
    sessions,
    tokenKeyVersion: 1,
    ttls: { sessionSeconds: 900 },
  });
}

describe('createSessionIssuer', () => {
  it('mints ACCESS+REFRESH tokens sharing one sessionId and saves a Session with matching tokenHash', async () => {
    const sessions = new InMemorySessionRepository();
    const unitOfWork = new InMemoryUnitOfWork();
    const issueSessionFor = buildIssuer(sessions);

    const minted = await unitOfWork.withTransaction((tx) =>
      issueSessionFor({ userId: oid('user-1'), organizationId: ORG_ID, now: NOW, tx }),
    );

    const refreshToken = minted.refreshToken!;
    expect(minted.accessToken).not.toBe(refreshToken);
    const accessPayload = TOKEN_SERVICE.read(minted.accessToken);
    const refreshPayload = TOKEN_SERVICE.read(refreshToken);
    expect(accessPayload).toMatchObject({ tokenType: 'ACCESS' });
    expect(refreshPayload).toMatchObject({ tokenType: 'REFRESH' });
    expect(accessPayload && 'sessionId' in accessPayload ? accessPayload.sessionId : null).toBe(
      refreshPayload && 'sessionId' in refreshPayload ? refreshPayload.sessionId : null,
    );

    const saved = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(minted.accessToken));
    expect(saved).not.toBeNull();
    expect(saved?.tokenHash).toBe(TOKEN_SERVICE.fingerprint(minted.accessToken));
    expect(saved?.userId).toBe(oid('user-1'));
    expect(saved?.organizationId).toBe(ORG_ID);
    expect(saved?.adminOrganizationId).toBeNull();
    expect(saved?.actorType).toBe('USER');
    expect(saved?.expiresAt).toBe('2026-01-01T00:15:00.000Z');
  });

  it('mints ACCESS only (no refresh token) for a PLATFORM_ADMIN session', async () => {
    const sessions = new InMemorySessionRepository();
    const unitOfWork = new InMemoryUnitOfWork();
    const issueSessionFor = buildIssuer(sessions);

    const minted = await unitOfWork.withTransaction((tx) =>
      issueSessionFor({ adminOrganizationId: ADMIN_ID, now: NOW, tx }),
    );

    expect(minted.refreshToken).toBeNull();
    const accessPayload = TOKEN_SERVICE.read(minted.accessToken);
    expect(accessPayload).toMatchObject({ tokenType: 'ACCESS' });

    const saved = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(minted.accessToken));
    expect(saved).not.toBeNull();
    expect(saved?.actorType).toBe('PLATFORM_ADMIN');
    expect(saved?.adminOrganizationId).toBe(ADMIN_ID);
    expect(saved?.userId).toBeNull();
    expect(saved?.organizationId).toBeNull();
  });

  it('mints a fresh sessionId on every call', async () => {
    const sessions = new InMemorySessionRepository();
    const unitOfWork = new InMemoryUnitOfWork();
    const issueSessionFor = buildIssuer(sessions);

    const first = await unitOfWork.withTransaction((tx) =>
      issueSessionFor({ userId: oid('user-1'), organizationId: ORG_ID, now: NOW, tx }),
    );
    const second = await unitOfWork.withTransaction((tx) =>
      issueSessionFor({ userId: oid('user-1'), organizationId: ORG_ID, now: NOW, tx }),
    );

    expect(first.accessToken).not.toBe(second.accessToken);
    const firstSaved = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(first.accessToken));
    const secondSaved = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(second.accessToken));
    expect(firstSaved?.id).not.toBe(secondSaved?.id);
  });
});

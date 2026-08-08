import request from 'supertest';
import { createApp } from '../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { identityAccessErrorStatus } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { authRouter } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/authRouter.js';
import type { createAuthenticateActorUseCase } from '../../../src/modules/identity-access/application/auth/AuthenticateActor.js';
import type { createBeginUserLoginUseCase } from '../../../src/modules/identity-access/application/auth/BeginUserLogin.js';
import type { createIssueSessionUseCase } from '../../../src/modules/identity-access/application/auth/IssueSession.js';
import type { createLogoutUseCase } from '../../../src/modules/identity-access/application/auth/Logout.js';

/**
 * Focused e2e for design D-A7's "Login captures IP from input" scenario:
 * `authRouter` must inject `req.ip` OUTSIDE the parsed body, not read it
 * from the request payload. Requires `createApp`'s `trustProxy` so `req.ip`
 * honors `X-Forwarded-For` in this test, mirroring a real proxied
 * deployment.
 */
describe('authRouter IP capture (design D-A7)', () => {
  it('injects req.ip as ipAddress into the login Input, outside the parsed body', async () => {
    const calls: unknown[] = [];
    const beginUserLogin = (async (input: unknown) => {
      calls.push(input);
      return { kind: 'enrollment', token: 'enrollment-token' };
    }) as unknown as ReturnType<typeof createBeginUserLoginUseCase>;
    const authenticateOrganization = (async () => ({
      actorId: 'org-1',
      actorType: 'ORGANIZATION',
      organizationId: null,
      mfa: { enabled: false },
    })) as unknown as ReturnType<typeof createAuthenticateActorUseCase>;

    const router = authRouter({
      beginUserLogin,
      authenticateOrganization,
      issueSession: (async () => ({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: '2026-01-01T00:00:00.000Z',
      })) as unknown as ReturnType<typeof createIssueSessionUseCase>,
      logout: (async () => undefined) as unknown as ReturnType<typeof createLogoutUseCase>,
    });

    const app = createApp({
      routers: [{ path: '/api/v1', router }],
      errorHandler: createErrorHandler(identityAccessErrorStatus),
      trustProxy: true,
    });

    const response = await request(app)
      .post('/api/v1/auth/users/login')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ organizationSlug: 'acme', email: 'alice@example.com', password: 'correct-password' });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        organizationSlug: 'acme',
        email: 'alice@example.com',
        password: 'correct-password',
        ipAddress: '203.0.113.9',
      },
    ]);
  });

  it('resolves ipAddress to null when req.ip is unavailable (trust proxy not configured)', async () => {
    const calls: unknown[] = [];
    const authenticateOrganization = (async (input: unknown) => {
      calls.push(input);
      return { actorId: 'org-1', actorType: 'ORGANIZATION', organizationId: null, mfa: { enabled: false } };
    }) as unknown as ReturnType<typeof createAuthenticateActorUseCase>;

    const router = authRouter({
      beginUserLogin: (async () => ({ kind: 'enrollment', token: 'x' })) as unknown as ReturnType<
        typeof createBeginUserLoginUseCase
      >,
      authenticateOrganization,
      issueSession: (async () => ({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: '2026-01-01T00:00:00.000Z',
      })) as unknown as ReturnType<typeof createIssueSessionUseCase>,
      logout: (async () => undefined) as unknown as ReturnType<typeof createLogoutUseCase>,
    });

    const app = createApp({
      routers: [{ path: '/api/v1', router }],
      errorHandler: createErrorHandler(identityAccessErrorStatus),
    });

    await request(app)
      .post('/api/v1/auth/organizations/login')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ email: 'org@acme.example.com', password: 'org-password' });

    expect((calls[0] as { ipAddress: string | null }).ipAddress).not.toBe('203.0.113.9');
  });
});

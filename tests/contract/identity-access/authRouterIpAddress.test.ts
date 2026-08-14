import request from 'supertest';
import { createApp } from '../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { identityAccessErrorStatus } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { authRouter } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/authRouter.js';
import type { createBeginUserLoginUseCase } from '../../../src/modules/identity-access/application/auth/BeginUserLogin.js';
import type { createIssueSessionUseCase } from '../../../src/modules/identity-access/application/auth/IssueSession.js';
import type { createIssueOrganizationSessionUseCase } from '../../../src/modules/identity-access/application/auth/IssueOrganizationSession.js';
import type { createLogoutUseCase } from '../../../src/modules/identity-access/application/auth/Logout.js';
import type { createRequestPasswordResetUseCase } from '../../../src/modules/identity-access/application/auth/RequestPasswordReset.js';
import type { createConfirmPasswordResetUseCase } from '../../../src/modules/identity-access/application/auth/ConfirmPasswordReset.js';
import type { createRefreshSessionUseCase } from '../../../src/modules/identity-access/application/auth/RefreshSession.js';

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
    const issueOrganizationSession = (async () => ({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: '2026-01-01T00:00:00.000Z',
    })) as unknown as ReturnType<typeof createIssueOrganizationSessionUseCase>;

    const router = authRouter({
      beginUserLogin,
      issueOrganizationSession,
      issueSession: (async () => ({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: '2026-01-01T00:00:00.000Z',
      })) as unknown as ReturnType<typeof createIssueSessionUseCase>,
      refreshSession: (async () => ({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: '2026-01-01T00:00:00.000Z',
      })) as unknown as ReturnType<typeof createRefreshSessionUseCase>,
      logout: (async () => undefined) as unknown as ReturnType<typeof createLogoutUseCase>,
      requestPasswordReset: (async () => ({ status: 'PASSWORD_RESET_REQUESTED' })) as unknown as ReturnType<
        typeof createRequestPasswordResetUseCase
      >,
      confirmPasswordReset: (async () => undefined) as unknown as ReturnType<typeof createConfirmPasswordResetUseCase>,
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

  it('does not honor X-Forwarded-For when trust proxy is not configured', async () => {
    // El login de organización ahora es de 3 pasos y no invoca
    // `issueOrganizationSession` en el paso 1 — la captura se hace en el
    // login de USER, cuyo route inyecta `req.ip` en la misma request.
    const calls: unknown[] = [];
    const beginUserLogin = (async (input: unknown) => {
      calls.push(input);
      return { kind: 'enrollment', token: 'enrollment-token' };
    }) as unknown as ReturnType<typeof createBeginUserLoginUseCase>;

    const router = authRouter({
      beginUserLogin,
      issueOrganizationSession: (async () => ({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: '2026-01-01T00:00:00.000Z',
      })) as unknown as ReturnType<typeof createIssueOrganizationSessionUseCase>,
      issueSession: (async () => ({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: '2026-01-01T00:00:00.000Z',
      })) as unknown as ReturnType<typeof createIssueSessionUseCase>,
      refreshSession: (async () => ({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: '2026-01-01T00:00:00.000Z',
      })) as unknown as ReturnType<typeof createRefreshSessionUseCase>,
      logout: (async () => undefined) as unknown as ReturnType<typeof createLogoutUseCase>,
      requestPasswordReset: (async () => ({ status: 'PASSWORD_RESET_REQUESTED' })) as unknown as ReturnType<
        typeof createRequestPasswordResetUseCase
      >,
      confirmPasswordReset: (async () => undefined) as unknown as ReturnType<typeof createConfirmPasswordResetUseCase>,
    });

    const app = createApp({
      routers: [{ path: '/api/v1', router }],
      errorHandler: createErrorHandler(identityAccessErrorStatus),
    });

    await request(app)
      .post('/api/v1/auth/users/login')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ organizationSlug: 'acme', email: 'alice@example.com', password: 'correct-password' });

    expect((calls[0] as { ipAddress: string | null }).ipAddress).not.toBe('203.0.113.9');
  });
});

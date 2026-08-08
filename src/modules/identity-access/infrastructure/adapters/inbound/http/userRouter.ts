import { Router } from 'express';
import { parsePaginationParams } from '../../../../../../shared/http/pagination.js';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateUserUseCase } from '../../../../application/CreateUser.js';
import type { createGetUserUseCase } from '../../../../application/GetUser.js';
import type { createListUsersUseCase } from '../../../../application/ListUsers.js';
import type { createPatchUserIdentityUseCase } from '../../../../application/PatchUserIdentity.js';
import type { createTransitionUserStatusUseCase } from '../../../../application/TransitionUserStatus.js';
import type { createDeleteUserUseCase } from '../../../../application/DeleteUser.js';
import type { createSetupMfaUseCase } from '../../../../application/SetupMfa.js';
import type { createActivateMfaUseCase } from '../../../../application/ActivateMfa.js';
import type { createDisableMfaUseCase } from '../../../../application/DisableMfa.js';
import { createUserSchema, patchUserSchema, transitionUserSchema, activateMfaSchema } from './dto/userSchemas.js';
import { toUserListResponse, toUserResponse, toMfaSetupResponse } from './mappers/UserHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface UserRouterDeps {
  readonly createUser: ReturnType<typeof createCreateUserUseCase>;
  readonly getUser: ReturnType<typeof createGetUserUseCase>;
  readonly listUsers: ReturnType<typeof createListUsersUseCase>;
  readonly patchUserIdentity: ReturnType<typeof createPatchUserIdentityUseCase>;
  readonly transitionUserStatus: ReturnType<typeof createTransitionUserStatusUseCase>;
  readonly deleteUser: ReturnType<typeof createDeleteUserUseCase>;
  readonly setupMfa: ReturnType<typeof createSetupMfaUseCase>;
  readonly activateMfa: ReturnType<typeof createActivateMfaUseCase>;
  readonly disableMfa: ReturnType<typeof createDisableMfaUseCase>;
}

/**
 * `/users` routes (tenant-scoped, NOT platform-admin-gated per the
 * platform-admin-authorization spec: "User Routes Are Tenant-Scoped, Not
 * Platform-Admin-Gated"). Express 5 forwards a rejected handler promise to
 * `errorHandler` automatically.
 */
export function userRouter(deps: UserRouterDeps): Router {
  const router = Router();

  router.post('/users', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createUserSchema, req.body);
    const user = await deps.createUser({ auth, ...body });
    res.status(201).json(toUserResponse(user));
  });

  router.get('/users', async (req, res) => {
    const auth = requireAuthContext(req);
    const { limit, cursor } = parsePaginationParams(req.query);
    const page = await deps.listUsers({ auth, limit, cursor });
    res.status(200).json(toUserListResponse(page));
  });

  router.get('/users/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const user = await deps.getUser({ auth, userId: req.params.id! });
    res.status(200).json(toUserResponse(user));
  });

  router.patch('/users/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(patchUserSchema, req.body);
    const user = await deps.patchUserIdentity({ auth, userId: req.params.id!, ...body });
    res.status(200).json(toUserResponse(user));
  });

  router.post('/users/:id/transition', async (req, res) => {
    const auth = requireAuthContext(req);
    const { next } = parseRequest(transitionUserSchema, req.body);
    const user = await deps.transitionUserStatus({ auth, userId: req.params.id!, next });
    res.status(200).json(toUserResponse(user));
  });

  router.delete('/users/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const user = await deps.deleteUser({ auth, userId: req.params.id! });
    res.status(200).json(toUserResponse(user));
  });

  // mfa-user-enrollment PR2: act on the AUTHENTICATED user only — no :id
  // param, `auth.userId` is the target. `/users/me/...` never collides with
  // `/users/:id` (different segment counts).
  router.post('/users/me/mfa/setup', async (req, res) => {
    const auth = requireAuthContext(req);
    const result = await deps.setupMfa({ auth });
    res.status(200).json(toMfaSetupResponse(result));
  });

  router.post('/users/me/mfa/activate', async (req, res) => {
    const auth = requireAuthContext(req);
    const { token } = parseRequest(activateMfaSchema, req.body);
    const user = await deps.activateMfa({ auth, token });
    res.status(200).json(toUserResponse(user));
  });

  router.delete('/users/me/mfa', async (req, res) => {
    const auth = requireAuthContext(req);
    const user = await deps.disableMfa({ auth });
    res.status(200).json(toUserResponse(user));
  });

  return router;
}

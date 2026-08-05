import { Router } from 'express';
import { parsePaginationParams } from '../../../../../../shared/http/pagination.js';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateUserUseCase } from '../../../../application/CreateUser.js';
import type { createGetUserUseCase } from '../../../../application/GetUser.js';
import type { createListUsersUseCase } from '../../../../application/ListUsers.js';
import type { createPatchUserIdentityUseCase } from '../../../../application/PatchUserIdentity.js';
import type { createTransitionUserStatusUseCase } from '../../../../application/TransitionUserStatus.js';
import type { createDeleteUserUseCase } from '../../../../application/DeleteUser.js';
import { createUserSchema, patchUserSchema, transitionUserSchema } from './dto/userSchemas.js';
import { toUserListResponse, toUserResponse } from './mappers/UserHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface UserRouterDeps {
  readonly createUser: ReturnType<typeof createCreateUserUseCase>;
  readonly getUser: ReturnType<typeof createGetUserUseCase>;
  readonly listUsers: ReturnType<typeof createListUsersUseCase>;
  readonly patchUserIdentity: ReturnType<typeof createPatchUserIdentityUseCase>;
  readonly transitionUserStatus: ReturnType<typeof createTransitionUserStatusUseCase>;
  readonly deleteUser: ReturnType<typeof createDeleteUserUseCase>;
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

  return router;
}

import { Router } from 'express';
import { createApp } from './shared/http/createApp.js';
import { createErrorHandler } from './shared/http/errorHandler.js';
import { connectMongo } from './shared/persistence/mongo/connect.js';
import { ensureIndexes } from './shared/persistence/mongo/ensureIndexes.js';
import { SystemClock } from './shared/time/SystemClock.js';
import { identityAccessErrorStatus } from './modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { organizationRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/organizationRouter.js';
import { userRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/userRouter.js';
import { assertAuthModeSafeForProduction } from './modules/identity-access/infrastructure/adapters/inbound/http/auth/assertAuthModeSafeForProduction.js';
import { resolveAuthContextResolver } from './modules/identity-access/infrastructure/adapters/inbound/http/auth/resolveAuthContextResolver.js';
import { createAuthContextMiddleware } from './modules/identity-access/infrastructure/adapters/inbound/http/auth/authContextMiddleware.js';
import { MongoOrganizationRepository } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { MongoUserRepositoryFactory } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUserRepositoryFactory.js';
import { MongoUnitOfWork } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { BcryptPasswordHasher } from './modules/identity-access/infrastructure/adapters/outbound/crypto/BcryptPasswordHasher.js';
import { generateOrganizationId } from './modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { generateUserId } from './modules/identity-access/domain/model/value-objects/UserId.js';
import { createGetOrganizationUseCase } from './modules/identity-access/application/GetOrganization.js';
import { createListOrganizationsUseCase } from './modules/identity-access/application/ListOrganizations.js';
import { createPatchOrganizationIdentityUseCase } from './modules/identity-access/application/PatchOrganizationIdentity.js';
import { createTransitionOrganizationStatusUseCase } from './modules/identity-access/application/TransitionOrganizationStatus.js';
import { createDeleteOrganizationUseCase } from './modules/identity-access/application/DeleteOrganization.js';
import { createCreateOrganizationWithAdminUseCase } from './modules/identity-access/application/CreateOrganizationWithAdmin.js';
import { createCreateUserUseCase } from './modules/identity-access/application/CreateUser.js';
import { createGetUserUseCase } from './modules/identity-access/application/GetUser.js';
import { createListUsersUseCase } from './modules/identity-access/application/ListUsers.js';
import { createPatchUserIdentityUseCase } from './modules/identity-access/application/PatchUserIdentity.js';
import { createTransitionUserStatusUseCase } from './modules/identity-access/application/TransitionUserStatus.js';
import { createDeleteUserUseCase } from './modules/identity-access/application/DeleteUser.js';

const PORT = Number(process.env.PORT ?? 3000);
const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'anti_fraud_department';
const AUTH_MODE = process.env.AUTH_MODE ?? 'trusted-header';

async function bootstrap(): Promise<void> {
  // Fail-closed (design D4): AUTH_MODE=trusted-header trusts client headers
  // verbatim and must never run in production.
  assertAuthModeSafeForProduction(process.env.NODE_ENV, AUTH_MODE);

  const { client, db } = await connectMongo(MONGO_URI, MONGO_DB_NAME);
  await ensureIndexes(db);

  const clock = new SystemClock();
  const organizations = new MongoOrganizationRepository(db);
  const userRepositoryFactory = new MongoUserRepositoryFactory(db);
  const passwordHasher = new BcryptPasswordHasher();
  // Phase 3: a REAL Mongo-session-backed UnitOfWork — required for
  // CreateOrganizationWithAdmin's genuine cross-collection atomicity.
  // Phase 2's PassthroughUnitOfWork is deliberately NOT reused here.
  const unitOfWork = new MongoUnitOfWork(client);

  const transitionOrganizationStatus = createTransitionOrganizationStatusUseCase({
    organizations,
    unitOfWork,
    clock,
  });
  const transitionUserStatus = createTransitionUserStatusUseCase({ userRepositoryFactory, unitOfWork, clock });

  const identityAccessOrganizationsRouter = organizationRouter({
    createOrganizationWithAdmin: createCreateOrganizationWithAdminUseCase({
      organizations,
      userRepositoryFactory,
      passwordHasher,
      unitOfWork,
      clock,
      generateOrganizationId,
      generateUserId,
    }),
    getOrganization: createGetOrganizationUseCase({ organizations }),
    listOrganizations: createListOrganizationsUseCase({ organizations }),
    patchOrganizationIdentity: createPatchOrganizationIdentityUseCase({ organizations, clock }),
    transitionOrganizationStatus,
    deleteOrganization: createDeleteOrganizationUseCase({ transitionOrganizationStatus }),
  });

  const identityAccessUsersRouter = userRouter({
    createUser: createCreateUserUseCase({ userRepositoryFactory, passwordHasher, clock, generateId: generateUserId }),
    getUser: createGetUserUseCase({ userRepositoryFactory }),
    listUsers: createListUsersUseCase({ userRepositoryFactory }),
    patchUserIdentity: createPatchUserIdentityUseCase({ userRepositoryFactory, clock }),
    transitionUserStatus,
    deleteUser: createDeleteUserUseCase({ transitionUserStatus }),
  });

  const authContextMiddleware = createAuthContextMiddleware(resolveAuthContextResolver(AUTH_MODE));

  const identityAccessRouter = Router();
  identityAccessRouter.use(authContextMiddleware);
  identityAccessRouter.use(identityAccessOrganizationsRouter);
  identityAccessRouter.use(identityAccessUsersRouter);

  const app = createApp({
    routers: [{ path: '/api/v1', router: identityAccessRouter }],
    errorHandler: createErrorHandler(identityAccessErrorStatus),
  });

  app.listen(PORT, () => {
    console.log(`anti-fraud-department listening on port ${PORT}`);
  });
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal error during bootstrap:', error);
  process.exitCode = 1;
});

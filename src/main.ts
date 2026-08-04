import { createApp } from './shared/http/createApp.js';
import { createErrorHandler } from './shared/http/errorHandler.js';
import { connectMongo } from './shared/persistence/mongo/connect.js';
import { ensureIndexes } from './shared/persistence/mongo/ensureIndexes.js';
import { SystemClock } from './shared/time/SystemClock.js';
import { identityAccessErrorStatus } from './modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { organizationRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/organizationRouter.js';
import { MongoOrganizationRepository } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { PassthroughUnitOfWork } from './modules/identity-access/infrastructure/PassthroughUnitOfWork.js';
import { generateOrganizationId } from './modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createCreateOrganizationUseCase } from './modules/identity-access/application/CreateOrganization.js';
import { createGetOrganizationUseCase } from './modules/identity-access/application/GetOrganization.js';
import { createListOrganizationsUseCase } from './modules/identity-access/application/ListOrganizations.js';
import { createPatchOrganizationIdentityUseCase } from './modules/identity-access/application/PatchOrganizationIdentity.js';
import { createTransitionOrganizationStatusUseCase } from './modules/identity-access/application/TransitionOrganizationStatus.js';
import { createDeleteOrganizationUseCase } from './modules/identity-access/application/DeleteOrganization.js';

const PORT = Number(process.env.PORT ?? 3000);
const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'anti_fraud_department';

async function bootstrap(): Promise<void> {
  const { db } = await connectMongo(MONGO_URI, MONGO_DB_NAME);
  await ensureIndexes(db);

  const clock = new SystemClock();
  const organizations = new MongoOrganizationRepository(db);
  // Phase 2 organization use cases never span more than one aggregate, so a
  // passthrough is correct here (see its own doc comment). Phase 3's
  // CreateOrganizationWithAdmin needs a real Mongo-session-backed
  // UnitOfWork and must not reuse this one.
  const unitOfWork = new PassthroughUnitOfWork();

  const transitionOrganizationStatus = createTransitionOrganizationStatusUseCase({
    organizations,
    unitOfWork,
    clock,
  });

  const identityAccessRouter = organizationRouter({
    createOrganization: createCreateOrganizationUseCase({ organizations, clock, generateId: generateOrganizationId }),
    getOrganization: createGetOrganizationUseCase({ organizations }),
    listOrganizations: createListOrganizationsUseCase({ organizations }),
    patchOrganizationIdentity: createPatchOrganizationIdentityUseCase({ organizations, clock }),
    transitionOrganizationStatus,
    deleteOrganization: createDeleteOrganizationUseCase({ transitionOrganizationStatus }),
  });

  // NOTE: no `authContextMiddleware` is wired yet — every request hits
  // `requireAuthContext` and fails until Phase 3 adds
  // `TrustedHeaderAuthContextResolver` (proposal Dependencies: "Follow-up
  // change for authentication... before endpoints are usable by real
  // clients"). The router/use case/repository stack itself is fully real.
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

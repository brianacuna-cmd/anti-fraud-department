import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { oid } from '../../../support/oid.js';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { screeningErrorStatus } from '../../../../src/modules/screening/infrastructure/adapters/inbound/http/errorStatus.js';
import { watchlistRouter } from '../../../../src/modules/screening/infrastructure/adapters/inbound/http/watchlistRouter.js';
import { generateWatchlistId, createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { generateWatchlistEntryId, createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { Watchlist } from '../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { WatchlistEntry } from '../../../../src/modules/screening/domain/model/aggregates/WatchlistEntry.js';
import { InMemoryWatchlistRepository } from '../../../helpers/screening/InMemoryWatchlistRepository.js';
import { InMemoryWatchlistEntryRepository } from '../../../helpers/screening/InMemoryWatchlistEntryRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';
import { createCreateWatchlistUseCase } from '../../../../src/modules/screening/application/CreateWatchlist.js';
import { createListWatchlistsUseCase } from '../../../../src/modules/screening/application/ListWatchlists.js';
import { createGetWatchlistUseCase } from '../../../../src/modules/screening/application/GetWatchlist.js';
import { createUpdateWatchlistUseCase } from '../../../../src/modules/screening/application/UpdateWatchlist.js';
import { createDeleteWatchlistUseCase } from '../../../../src/modules/screening/application/DeleteWatchlist.js';
import { createCreateWatchlistEntryUseCase } from '../../../../src/modules/screening/application/CreateWatchlistEntry.js';
import { createListWatchlistEntriesUseCase } from '../../../../src/modules/screening/application/ListWatchlistEntries.js';
import { createUpdateWatchlistEntryUseCase } from '../../../../src/modules/screening/application/UpdateWatchlistEntry.js';
import { createDeleteWatchlistEntryUseCase } from '../../../../src/modules/screening/application/DeleteWatchlistEntry.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/screening/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/screening/domain/ports/UnitOfWork.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ORG_1_ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });

class RecordingAuditRecorder implements AuditRecorder {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent, _tx?: Transaction): Promise<void> {
    this.events.push(event);
  }
}

function buildApp(actorPerRequest: () => AuthContext = () => ORG_1_ANALYST) {
  const watchlistRepository = new InMemoryWatchlistRepository();
  const watchlistEntryRepository = new InMemoryWatchlistEntryRepository();
  const auditRecorder = new RecordingAuditRecorder();
  const unitOfWork = new PassthroughUnitOfWork();
  const clock = new FixedClock(NOW);
  const indexWatchlistEntry = async (): Promise<void> => {};

  const router = watchlistRouter({
    createWatchlist: createCreateWatchlistUseCase({
      watchlistRepository,
      auditRecorder,
      unitOfWork,
      clock,
      generateWatchlistId,
    }),
    listWatchlists: createListWatchlistsUseCase({ watchlistRepository }),
    getWatchlist: createGetWatchlistUseCase({ watchlistRepository }),
    updateWatchlist: createUpdateWatchlistUseCase({
      watchlistRepository,
      auditRecorder,
      unitOfWork,
      clock,
    }),
    deleteWatchlist: createDeleteWatchlistUseCase({
      watchlistRepository,
      watchlistEntryRepository,
      auditRecorder,
      unitOfWork,
      clock,
    }),
    createWatchlistEntry: createCreateWatchlistEntryUseCase({
      watchlistRepository,
      watchlistEntryRepository,
      auditRecorder,
      unitOfWork,
      clock,
      generateWatchlistEntryId,
      indexWatchlistEntry,
    }),
    listWatchlistEntries: createListWatchlistEntriesUseCase({ watchlistRepository, watchlistEntryRepository }),
    updateWatchlistEntry: createUpdateWatchlistEntryUseCase({
      watchlistEntryRepository,
      auditRecorder,
      unitOfWork,
      clock,
      indexWatchlistEntry,
    }),
    deleteWatchlistEntry: createDeleteWatchlistEntryUseCase({
      watchlistEntryRepository,
      auditRecorder,
      unitOfWork,
      clock,
    }),
  });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(req, actorPerRequest());
    next();
  }

  const mounted = Router();
  mounted.use(testAuthMiddleware);
  mounted.use(router);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(screeningErrorStatus),
  });

  return { app, watchlistRepository, watchlistEntryRepository, auditRecorder };
}

describe('POST /api/v1/watchlists/:id/entries', () => {
  it('creates an ACTIVE entry and returns 201', async () => {
    const { app, watchlistRepository } = buildApp();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_1, name: 'OFAC', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );

    const response = await request(app)
      .post(`/api/v1/watchlists/${oid('watchlist-1')}/entries`)
      .send({ name: 'John Smith', entryType: 'PERSON' });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe('John Smith');
    expect(response.body.status).toBe('ACTIVE');
    expect(response.body.entryType).toBe('PERSON');
  });

  it('returns 404 when the watchlist belongs to another org', async () => {
    const { app, watchlistRepository } = buildApp();
    await watchlistRepository.create(
      Watchlist.create({
        id: createWatchlistId(oid('watchlist-org2')),
        organizationId: ORG_2,
        name: 'Other',
        source: 'EU',
        type: 'BLACKLIST',
        now: NOW,
      }),
    );

    const response = await request(app)
      .post(`/api/v1/watchlists/${oid('watchlist-org2')}/entries`)
      .send({ name: 'John', entryType: 'PERSON' });

    expect(response.status).toBe(404);
  });

  it('returns 400 for an invalid request body', async () => {
    const { app, watchlistRepository } = buildApp();
    await watchlistRepository.create(
      Watchlist.create({ id: createWatchlistId(oid('watchlist-1')), organizationId: ORG_1, name: 'OFAC', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );

    const response = await request(app)
      .post(`/api/v1/watchlists/${oid('watchlist-1')}/entries`)
      .send({ entryType: 'PERSON' });

    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/watchlists/:id/entries', () => {
  it('returns entries with total for the caller org', async () => {
    const { app, watchlistRepository, watchlistEntryRepository } = buildApp();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_1, name: 'OFAC', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );
    await watchlistEntryRepository.create(
      WatchlistEntry.create({ id: generateWatchlistEntryId(), watchlistId, organizationId: ORG_1, entryType: 'PERSON', name: 'Alice', now: NOW }),
    );
    await watchlistEntryRepository.create(
      WatchlistEntry.create({ id: generateWatchlistEntryId(), watchlistId, organizationId: ORG_1, entryType: 'PERSON', name: 'Bob', now: NOW }),
    );

    const response = await request(app).get(`/api/v1/watchlists/${oid('watchlist-1')}/entries`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(response.body.items).toHaveLength(2);
  });

  it('returns 404 for a cross-tenant watchlist', async () => {
    const { app, watchlistRepository } = buildApp();
    await watchlistRepository.create(
      Watchlist.create({
        id: createWatchlistId(oid('watchlist-org2')),
        organizationId: ORG_2,
        name: 'Other',
        source: 'EU',
        type: 'BLACKLIST',
        now: NOW,
      }),
    );

    const response = await request(app).get(`/api/v1/watchlists/${oid('watchlist-org2')}/entries`);

    expect(response.status).toBe(404);
  });

  it('returns 404 when the parent watchlist is soft-deleted', async () => {
    const { app, watchlistRepository } = buildApp();
    const watchlist = Watchlist.create({
      id: createWatchlistId(oid('watchlist-1')),
      organizationId: ORG_1,
      name: 'OFAC',
      source: 'OFAC',
      type: 'BLACKLIST',
      now: NOW,
    });
    await watchlistRepository.create(watchlist.softDelete(NOW));

    const response = await request(app).get(`/api/v1/watchlists/${oid('watchlist-1')}/entries`);

    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/v1/watchlists/:id/entries/:entryId', () => {
  it('updates the entry and returns 200', async () => {
    const { app, watchlistRepository, watchlistEntryRepository } = buildApp();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    const entryId = createWatchlistEntryId(oid('entry-1'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_1, name: 'OFAC', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );
    await watchlistEntryRepository.create(
      WatchlistEntry.create({ id: entryId, watchlistId, organizationId: ORG_1, entryType: 'PERSON', name: 'Alice', now: NOW }),
    );

    const response = await request(app)
      .patch(`/api/v1/watchlists/${oid('watchlist-1')}/entries/${oid('entry-1')}`)
      .send({ riskLevel: 'HIGH' });

    expect(response.status).toBe(200);
    expect(response.body.riskLevel).toBe('HIGH');
    expect(response.body.name).toBe('Alice');
  });

  it('returns 400 when trying to patch status (REMOVED is only via DELETE)', async () => {
    const { app, watchlistRepository, watchlistEntryRepository } = buildApp();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    const entryId = createWatchlistEntryId(oid('entry-1'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_1, name: 'OFAC', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );
    await watchlistEntryRepository.create(
      WatchlistEntry.create({ id: entryId, watchlistId, organizationId: ORG_1, entryType: 'PERSON', name: 'Alice', now: NOW }),
    );

    const response = await request(app)
      .patch(`/api/v1/watchlists/${oid('watchlist-1')}/entries/${oid('entry-1')}`)
      .send({ status: 'REMOVED' });

    expect(response.status).toBe(400);
  });

  it('returns 404 when the parent watchlist id in the URL does not own the entry', async () => {
    const { app, watchlistRepository, watchlistEntryRepository } = buildApp();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    const otherWatchlistId = createWatchlistId(oid('watchlist-other'));
    const entryId = createWatchlistEntryId(oid('entry-1'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_1, name: 'OFAC', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );
    await watchlistRepository.create(
      Watchlist.create({
        id: otherWatchlistId,
        organizationId: ORG_1,
        name: 'EU',
        source: 'EU',
        type: 'BLACKLIST',
        now: NOW,
      }),
    );
    await watchlistEntryRepository.create(
      WatchlistEntry.create({ id: entryId, watchlistId, organizationId: ORG_1, entryType: 'PERSON', name: 'Alice', now: NOW }),
    );

    const response = await request(app)
      .patch(`/api/v1/watchlists/${oid('watchlist-other')}/entries/${oid('entry-1')}`)
      .send({ riskLevel: 'HIGH' });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/v1/watchlists/:id/entries/:entryId', () => {
  it('soft-deletes the entry and returns 200', async () => {
    const { app, watchlistRepository, watchlistEntryRepository } = buildApp();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    const entryId = createWatchlistEntryId(oid('entry-1'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_1, name: 'OFAC', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );
    await watchlistEntryRepository.create(
      WatchlistEntry.create({ id: entryId, watchlistId, organizationId: ORG_1, entryType: 'PERSON', name: 'Alice', now: NOW }),
    );

    const response = await request(app).delete(`/api/v1/watchlists/${oid('watchlist-1')}/entries/${oid('entry-1')}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('REMOVED');
  });

  it('returns 404 for a cross-tenant entry', async () => {
    const { app, watchlistRepository, watchlistEntryRepository } = buildApp();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    const entryId = createWatchlistEntryId(oid('entry-1'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_1, name: 'OFAC', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );
    await watchlistEntryRepository.create(
      WatchlistEntry.create({ id: entryId, watchlistId, organizationId: ORG_2, entryType: 'PERSON', name: 'Bob', now: NOW }),
    );

    const response = await request(app).delete(`/api/v1/watchlists/${oid('watchlist-1')}/entries/${oid('entry-1')}`);

    expect(response.status).toBe(404);
  });

  it('returns 404 when the parent watchlist id in the URL does not own the entry', async () => {
    const { app, watchlistRepository, watchlistEntryRepository } = buildApp();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    const otherWatchlistId = createWatchlistId(oid('watchlist-other'));
    const entryId = createWatchlistEntryId(oid('entry-1'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_1, name: 'OFAC', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );
    await watchlistRepository.create(
      Watchlist.create({
        id: otherWatchlistId,
        organizationId: ORG_1,
        name: 'EU',
        source: 'EU',
        type: 'BLACKLIST',
        now: NOW,
      }),
    );
    await watchlistEntryRepository.create(
      WatchlistEntry.create({ id: entryId, watchlistId, organizationId: ORG_1, entryType: 'PERSON', name: 'Alice', now: NOW }),
    );

    const response = await request(app).delete(
      `/api/v1/watchlists/${oid('watchlist-other')}/entries/${oid('entry-1')}`,
    );

    expect(response.status).toBe(404);
  });
});

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
import { Watchlist } from '../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { InMemoryWatchlistRepository } from '../../../helpers/screening/InMemoryWatchlistRepository.js';
import { InMemoryWatchlistEntryRepository } from '../../../helpers/screening/InMemoryWatchlistEntryRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';
import { createCreateWatchlistUseCase } from '../../../../src/modules/screening/application/CreateWatchlist.js';
import { createListWatchlistsUseCase } from '../../../../src/modules/screening/application/ListWatchlists.js';
import { createGetWatchlistUseCase } from '../../../../src/modules/screening/application/GetWatchlist.js';
import { createUpdateWatchlistUseCase } from '../../../../src/modules/screening/application/UpdateWatchlist.js';
import { createDeleteWatchlistUseCase } from '../../../../src/modules/screening/application/DeleteWatchlist.js';
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

  return { app, watchlistRepository, auditRecorder };
}

describe('POST /api/v1/watchlists', () => {
  it('creates an ACTIVE watchlist and returns 201 with the created resource', async () => {
    const { app } = buildApp();

    const response = await request(app).post('/api/v1/watchlists').send({
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
    });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe('OFAC List');
    expect(response.body.status).toBe('ACTIVE');
    expect(response.body.type).toBe('BLACKLIST');
    expect(response.body.organizationId).toBe(ORG_1);
    expect(response.body.id).toBeDefined();
  });

  it('returns 409 when the name is already taken in the same org', async () => {
    const { app } = buildApp();
    await request(app).post('/api/v1/watchlists').send({ name: 'OFAC List', source: 'OFAC', type: 'BLACKLIST' });

    const response = await request(app).post('/api/v1/watchlists').send({
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
    });

    expect(response.status).toBe(409);
  });

  it('returns 400 for an invalid request body (missing required fields)', async () => {
    const { app } = buildApp();

    const response = await request(app).post('/api/v1/watchlists').send({ name: 'No Type' });

    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/watchlists', () => {
  it('returns only the caller org watchlists with total count', async () => {
    const { app, watchlistRepository } = buildApp();
    await watchlistRepository.create(
      Watchlist.create({ id: generateWatchlistId(), organizationId: ORG_1, name: 'A', source: 'S', type: 'BLACKLIST', now: NOW }),
    );
    await watchlistRepository.create(
      Watchlist.create({ id: generateWatchlistId(), organizationId: ORG_1, name: 'B', source: 'S', type: 'WHITELIST', now: NOW }),
    );
    await watchlistRepository.create(
      Watchlist.create({ id: generateWatchlistId(), organizationId: ORG_2, name: 'C', source: 'S', type: 'BLACKLIST', now: NOW }),
    );

    const response = await request(app).get('/api/v1/watchlists');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(response.body.items).toHaveLength(2);
  });

  it('returns an empty items array with the correct total when paginating beyond the last page', async () => {
    const { app, watchlistRepository } = buildApp();
    await watchlistRepository.create(
      Watchlist.create({ id: generateWatchlistId(), organizationId: ORG_1, name: 'A', source: 'S', type: 'BLACKLIST', now: NOW }),
    );

    const response = await request(app).get('/api/v1/watchlists').query({ limit: 10, offset: 10 });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items).toHaveLength(0);
  });

  it('returns 400 for an invalid limit value', async () => {
    const { app } = buildApp();

    const response = await request(app).get('/api/v1/watchlists').query({ limit: 0 });

    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/watchlists/:id', () => {
  it('returns the watchlist for the caller org', async () => {
    const { app, watchlistRepository } = buildApp();
    const watchlist = Watchlist.create({
      id: createWatchlistId(oid('watchlist-1')),
      organizationId: ORG_1,
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
      now: NOW,
    });
    await watchlistRepository.create(watchlist);

    const response = await request(app).get(`/api/v1/watchlists/${oid('watchlist-1')}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(oid('watchlist-1'));
    expect(response.body.name).toBe('OFAC List');
  });

  it('returns 404 for a watchlist belonging to another org', async () => {
    const { app, watchlistRepository } = buildApp();
    const watchlist = Watchlist.create({
      id: createWatchlistId(oid('watchlist-org2')),
      organizationId: ORG_2,
      name: 'Other List',
      source: 'EU',
      type: 'BLACKLIST',
      now: NOW,
    });
    await watchlistRepository.create(watchlist);

    const response = await request(app).get(`/api/v1/watchlists/${oid('watchlist-org2')}`);

    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/v1/watchlists/:id', () => {
  it('updates the watchlist and returns 200 with the updated resource', async () => {
    const { app, watchlistRepository } = buildApp();
    const watchlist = Watchlist.create({
      id: createWatchlistId(oid('watchlist-1')),
      organizationId: ORG_1,
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
      now: NOW,
    });
    await watchlistRepository.create(watchlist);

    const response = await request(app)
      .patch(`/api/v1/watchlists/${oid('watchlist-1')}`)
      .send({ description: 'Updated description' });

    expect(response.status).toBe(200);
    expect(response.body.description).toBe('Updated description');
    expect(response.body.name).toBe('OFAC List');
  });

  it('returns 404 for a cross-tenant update', async () => {
    const { app, watchlistRepository } = buildApp();
    const watchlist = Watchlist.create({
      id: createWatchlistId(oid('watchlist-org2')),
      organizationId: ORG_2,
      name: 'Other List',
      source: 'EU',
      type: 'BLACKLIST',
      now: NOW,
    });
    await watchlistRepository.create(watchlist);

    const response = await request(app)
      .patch(`/api/v1/watchlists/${oid('watchlist-org2')}`)
      .send({ description: 'Hacked' });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/v1/watchlists/:id', () => {
  it('soft-deletes the watchlist and returns 200 with the deleted resource', async () => {
    const { app, watchlistRepository } = buildApp();
    const watchlist = Watchlist.create({
      id: createWatchlistId(oid('watchlist-1')),
      organizationId: ORG_1,
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
      now: NOW,
    });
    await watchlistRepository.create(watchlist);

    const response = await request(app).delete(`/api/v1/watchlists/${oid('watchlist-1')}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('INACTIVE');
    expect(response.body.deletedAt).toBe(NOW);
  });

  it('is idempotent — repeating the delete returns 200 with no extra audit rows', async () => {
    const { app, watchlistRepository, auditRecorder } = buildApp();
    const watchlist = Watchlist.create({
      id: createWatchlistId(oid('watchlist-1')),
      organizationId: ORG_1,
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
      now: NOW,
    });
    await watchlistRepository.create(watchlist);

    await request(app).delete(`/api/v1/watchlists/${oid('watchlist-1')}`);
    const second = await request(app).delete(`/api/v1/watchlists/${oid('watchlist-1')}`);

    expect(second.status).toBe(200);
    expect(auditRecorder.events).toHaveLength(1);
  });
});

import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateWatchlistUseCase } from '../../../../application/CreateWatchlist.js';
import type { createListWatchlistsUseCase } from '../../../../application/ListWatchlists.js';
import type { createGetWatchlistUseCase } from '../../../../application/GetWatchlist.js';
import type { createUpdateWatchlistUseCase } from '../../../../application/UpdateWatchlist.js';
import type { createDeleteWatchlistUseCase } from '../../../../application/DeleteWatchlist.js';
import type { createCreateWatchlistEntryUseCase } from '../../../../application/CreateWatchlistEntry.js';
import type { createListWatchlistEntriesUseCase } from '../../../../application/ListWatchlistEntries.js';
import type { createUpdateWatchlistEntryUseCase } from '../../../../application/UpdateWatchlistEntry.js';
import type { createDeleteWatchlistEntryUseCase } from '../../../../application/DeleteWatchlistEntry.js';
import {
  createWatchlistSchema,
  listWatchlistsQuerySchema,
  updateWatchlistSchema,
  createWatchlistEntrySchema,
  listWatchlistEntriesQuerySchema,
  updateWatchlistEntrySchema,
} from './dto/watchlistSchemas.js';
import { toWatchlistResponse, toWatchlistEntryResponse } from './mappers/WatchlistHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface WatchlistRouterDeps {
  readonly createWatchlist: ReturnType<typeof createCreateWatchlistUseCase>;
  readonly listWatchlists: ReturnType<typeof createListWatchlistsUseCase>;
  readonly getWatchlist: ReturnType<typeof createGetWatchlistUseCase>;
  readonly updateWatchlist: ReturnType<typeof createUpdateWatchlistUseCase>;
  readonly deleteWatchlist: ReturnType<typeof createDeleteWatchlistUseCase>;
  readonly createWatchlistEntry: ReturnType<typeof createCreateWatchlistEntryUseCase>;
  readonly listWatchlistEntries: ReturnType<typeof createListWatchlistEntriesUseCase>;
  readonly updateWatchlistEntry: ReturnType<typeof createUpdateWatchlistEntryUseCase>;
  readonly deleteWatchlistEntry: ReturnType<typeof createDeleteWatchlistEntryUseCase>;
}

/**
 * `/watchlists` routes: watchlist CRUD (Slice A2) + entry sub-routes (Slice B2).
 * Express 5 forwards rejected handler promises to `errorHandler` automatically
 * (mirrors `amlAlertRouter`).
 */
export function watchlistRouter(deps: WatchlistRouterDeps): Router {
  const router = Router();

  // ── Watchlist routes ──────────────────────────────────────────────────────

  router.post('/watchlists', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createWatchlistSchema, req.body);
    const watchlist = await deps.createWatchlist({
      auth,
      name: body.name,
      source: body.source,
      type: body.type,
      description: body.description ?? null,
    });
    res.status(201).json(toWatchlistResponse(watchlist));
  });

  router.get('/watchlists', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(listWatchlistsQuerySchema, req.query);
    const page = await deps.listWatchlists({
      auth,
      type: query.type,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
    res.status(200).json({
      items: page.items.map(toWatchlistResponse),
      total: page.total,
    });
  });

  router.get('/watchlists/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const watchlist = await deps.getWatchlist({ auth, watchlistId: req.params.id! });
    res.status(200).json(toWatchlistResponse(watchlist));
  });

  router.patch('/watchlists/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(updateWatchlistSchema, req.body);
    const watchlist = await deps.updateWatchlist({
      auth,
      watchlistId: req.params.id!,
      name: body.name,
      source: body.source,
      description: body.description,
    });
    res.status(200).json(toWatchlistResponse(watchlist));
  });

  router.delete('/watchlists/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const watchlist = await deps.deleteWatchlist({ auth, watchlistId: req.params.id! });
    res.status(200).json(toWatchlistResponse(watchlist));
  });

  // ── WatchlistEntry sub-routes ─────────────────────────────────────────────

  router.post('/watchlists/:id/entries', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createWatchlistEntrySchema, req.body);
    const entry = await deps.createWatchlistEntry({
      auth,
      watchlistId: req.params.id!,
      name: body.name,
      entryType: body.entryType,
      document: body.document ?? null,
      walletAddress: body.walletAddress ?? null,
      riskLevel: body.riskLevel ?? null,
      country: body.country ?? null,
    });
    res.status(201).json(toWatchlistEntryResponse(entry));
  });

  router.get('/watchlists/:id/entries', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(listWatchlistEntriesQuerySchema, req.query);
    const page = await deps.listWatchlistEntries({
      auth,
      watchlistId: req.params.id!,
      status: query.status,
      entryType: query.entryType,
      riskLevel: query.riskLevel,
      country: query.country,
      limit: query.limit,
      offset: query.offset,
    });
    res.status(200).json({
      items: page.items.map(toWatchlistEntryResponse),
      total: page.total,
    });
  });

  router.patch('/watchlists/:id/entries/:entryId', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(updateWatchlistEntrySchema, req.body);
    const entry = await deps.updateWatchlistEntry({
      auth,
      watchlistId: req.params.id!,
      entryId: req.params.entryId!,
      name: body.name,
      entryType: body.entryType,
      document: body.document,
      walletAddress: body.walletAddress,
      riskLevel: body.riskLevel,
      country: body.country,
    });
    res.status(200).json(toWatchlistEntryResponse(entry));
  });

  router.delete('/watchlists/:id/entries/:entryId', async (req, res) => {
    const auth = requireAuthContext(req);
    const entry = await deps.deleteWatchlistEntry({
      auth,
      watchlistId: req.params.id!,
      entryId: req.params.entryId!,
    });
    res.status(200).json(toWatchlistEntryResponse(entry));
  });

  return router;
}

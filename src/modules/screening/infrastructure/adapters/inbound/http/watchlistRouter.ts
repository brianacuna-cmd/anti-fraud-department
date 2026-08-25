import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateWatchlistUseCase } from '../../../../application/CreateWatchlist.js';
import type { createListWatchlistsUseCase } from '../../../../application/ListWatchlists.js';
import type { createGetWatchlistUseCase } from '../../../../application/GetWatchlist.js';
import type { createUpdateWatchlistUseCase } from '../../../../application/UpdateWatchlist.js';
import type { createDeleteWatchlistUseCase } from '../../../../application/DeleteWatchlist.js';
import { createWatchlistSchema, listWatchlistsQuerySchema, updateWatchlistSchema } from './dto/watchlistSchemas.js';
import { toWatchlistResponse } from './mappers/WatchlistHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface WatchlistRouterDeps {
  readonly createWatchlist: ReturnType<typeof createCreateWatchlistUseCase>;
  readonly listWatchlists: ReturnType<typeof createListWatchlistsUseCase>;
  readonly getWatchlist: ReturnType<typeof createGetWatchlistUseCase>;
  readonly updateWatchlist: ReturnType<typeof createUpdateWatchlistUseCase>;
  readonly deleteWatchlist: ReturnType<typeof createDeleteWatchlistUseCase>;
}

/**
 * `/watchlists` routes: watchlist CRUD (Slice A2).
 * Express 5 forwards rejected handler promises to `errorHandler` automatically
 * (mirrors `amlAlertRouter`).
 */
export function watchlistRouter(deps: WatchlistRouterDeps): Router {
  const router = Router();

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

  return router;
}

import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateCaseUseCase } from '../../../../application/CreateCase.js';
import type { createListCasesUseCase } from '../../../../application/ListCases.js';
import type { createGetCaseUseCase } from '../../../../application/GetCase.js';
import type { createTransitionCaseStatusUseCase } from '../../../../application/TransitionCaseStatus.js';
import type { createGetCaseTimelineUseCase } from '../../../../application/GetCaseTimeline.js';
import type { createSyncFinturuDataUseCase } from '../../../../application/SyncFinturuData.js';
import type { FinturuApiClient } from '../../outbound/finturu/FinturuApiClient.js';
import { createCaseSchema } from './dto/caseSchemas.js';
import { toCaseResponse } from './mappers/CaseHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface CaseRouterDeps {
  readonly createCase: ReturnType<typeof createCreateCaseUseCase>;
  readonly listCases: ReturnType<typeof createListCasesUseCase>;
  readonly getCase: ReturnType<typeof createGetCaseUseCase>;
  readonly transitionCaseStatus: ReturnType<typeof createTransitionCaseStatusUseCase>;
  readonly getCaseTimeline: ReturnType<typeof createGetCaseTimelineUseCase>;
  readonly syncFinturuData?: ReturnType<typeof createSyncFinturuDataUseCase>;
  readonly finturuClient?: FinturuApiClient;
}

export function caseRouter(deps: CaseRouterDeps): Router {
  const router = Router();

  // On-demand Provider Queries
  router.get('/cases/providers/bridge/customer/:idUserBridge', async (req, res) => {
    requireAuthContext(req);
    if (!deps.finturuClient) return res.status(501).json({ message: 'Finturu client not available' });
    const data = await deps.finturuClient.getCustomer(req.params.idUserBridge!);
    res.status(200).json(data);
  });

  router.get('/cases/providers/bridge/wallets/:idUserBridge', async (req, res) => {
    requireAuthContext(req);
    if (!deps.finturuClient) return res.status(501).json({ message: 'Finturu client not available' });
    const data = await deps.finturuClient.getUserWallets(req.params.idUserBridge!);
    res.status(200).json(data);
  });

  router.get('/cases/providers/bridge/wallet-history/:walletBridge', async (req, res) => {
    requireAuthContext(req);
    if (!deps.finturuClient) return res.status(501).json({ message: 'Finturu client not available' });
    const data = await deps.finturuClient.getWalletHistory(req.params.walletBridge!);
    res.status(200).json(data);
  });

  router.get('/cases/providers/bridge/external-accounts/:idUserBridge', async (req, res) => {
    requireAuthContext(req);
    if (!deps.finturuClient) return res.status(501).json({ message: 'Finturu client not available' });
    const data = await deps.finturuClient.getExternalAccounts(req.params.idUserBridge!);
    res.status(200).json(data);
  });

  router.get('/cases/providers/bridge/virtual-accounts/:idUserBridge', async (req, res) => {
    requireAuthContext(req);
    if (!deps.finturuClient) return res.status(501).json({ message: 'Finturu client not available' });
    const data = await deps.finturuClient.getVirtualAccounts(req.params.idUserBridge!);
    res.status(200).json(data);
  });

  router.get('/cases/providers/bridge/ach-history/:idUserBridge', async (req, res) => {
    requireAuthContext(req);
    if (!deps.finturuClient) return res.status(501).json({ message: 'Finturu client not available' });
    const data = await deps.finturuClient.getAchHistory(req.params.idUserBridge!);
    res.status(200).json(data);
  });

  router.get('/cases/providers/bridge/customer-transfers/:idUserBridge', async (req, res) => {
    requireAuthContext(req);
    if (!deps.finturuClient) return res.status(501).json({ message: 'Finturu client not available' });
    const data = await deps.finturuClient.getCustomerBridgeTransfers(req.params.idUserBridge!);
    res.status(200).json(data);
  });

  router.get('/cases/providers/finturu/customer-transfers/:idUserBridge', async (req, res) => {
    requireAuthContext(req);
    if (!deps.finturuClient) return res.status(501).json({ message: 'Finturu client not available' });
    const data = await deps.finturuClient.getCustomerFinturuTransfers(req.params.idUserBridge!);
    res.status(200).json(data);
  });

  router.get('/cases/providers/bridge/transfer/:idTransfer', async (req, res) => {
    requireAuthContext(req);
    if (!deps.finturuClient) return res.status(501).json({ message: 'Finturu client not available' });
    const data = await deps.finturuClient.getTransfer(req.params.idTransfer!);
    res.status(200).json(data);
  });

  router.get('/cases/providers/stripe/customer/:idCustomer', async (req, res) => {
    requireAuthContext(req);
    if (!deps.finturuClient) return res.status(501).json({ message: 'Finturu client not available' });
    const data = await deps.finturuClient.getStripeCustomer(req.params.idCustomer!);
    res.status(200).json(data);
  });

  router.get('/cases/providers/stripe/by-email', async (req, res) => {
    requireAuthContext(req);
    if (!deps.finturuClient) return res.status(501).json({ message: 'Finturu client not available' });
    const email = typeof req.query.email === 'string' ? req.query.email : '';
    if (!email) return res.status(400).json({ message: 'Email query parameter required' });
    const data = await deps.finturuClient.getStripeCustomerByEmail(email);
    res.status(200).json(data);
  });

  router.post('/cases/sync/finturu', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.syncFinturuData) {
      res.status(501).json({ message: 'Sync service is not enabled' });
      return;
    }
    const result = await deps.syncFinturuData({ auth });
    res.status(200).json({
      success: true,
      totalSynced: result.totalSynced,
      cases: result.cases.map(toCaseResponse),
    });
  });

  router.post('/cases', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createCaseSchema, req.body);
    const kase = await deps.createCase({ auth, ...body });
    res.status(201).json(toCaseResponse(kase));
  });

  router.get('/cases', async (req, res) => {
    const auth = requireAuthContext(req);
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const page = await deps.listCases({ auth, limit, cursor, status });
    res.status(200).json({
      items: page.items.map(toCaseResponse),
      nextCursor: page.nextCursor,
    });
  });

  router.get('/cases/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const kase = await deps.getCase({ auth, caseId: req.params.id! });
    res.status(200).json(toCaseResponse(kase));
  });

  router.post('/cases/:id/transition', async (req, res) => {
    const auth = requireAuthContext(req);
    const nextStatus = (req.body as { next?: string; status?: string }).next ?? (req.body as { status?: string }).status;
    if (!nextStatus) {
      res.status(400).json({ message: 'El campo next o status es requerido' });
      return;
    }
    const kase = await deps.transitionCaseStatus({ auth, caseId: req.params.id!, nextStatus });
    res.status(200).json(toCaseResponse(kase));
  });

  router.get('/cases/:id/timeline', async (req, res) => {
    const auth = requireAuthContext(req);
    const events = await deps.getCaseTimeline({ auth, caseId: req.params.id! });
    res.status(200).json(
      events.map((e) => ({
        id: e.id,
        caseId: e.caseId,
        eventType: e.eventType,
        previousValue: e.previousValue,
        newValue: e.newValue,
        createdBy: e.createdBy,
        createdAt: e.createdAt,
      }))
    );
  });

  return router;
}


import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createSyncFinturuDataUseCase } from '../../../../application/SyncFinturuData.js';
import type { createGetFinturuDirectoryUseCase } from '../../../../application/GetFinturuDirectory.js';
import type { DirectorySyncScheduler } from '../../../../application/DirectorySyncScheduler.js';
import type { createOpenFraudCaseUseCase } from '../../../../application/OpenFraudCaseFromCustomer.js';
import type { FinturuApiClient } from '../../outbound/finturu/FinturuApiClient.js';
import { toCaseResponse } from './mappers/CaseHttpMapper.js';

export interface FinturuRouterDeps {
  readonly syncFinturuData?: ReturnType<typeof createSyncFinturuDataUseCase>;
  readonly getFinturuDirectory?: ReturnType<typeof createGetFinturuDirectoryUseCase>;
  readonly directorySyncScheduler?: DirectorySyncScheduler;
  readonly openFraudCase?: ReturnType<typeof createOpenFraudCaseUseCase>;
  readonly finturuClient?: FinturuApiClient;
}

/**
 * Dedicated Finturu integration routes: live queries to the providers
 * (Bridge, Stripe), the customer directory, and opening a case from a
 * directory customer.
 *
 * Lives in a separate router —and not inside `caseRouter`— for the same
 * reason upstream split out `caseExportRouter`, `noteRouter`, or
 * `routingRuleRouter`: these are routes this fork adds on top of the module,
 * and keeping them out of the shared router avoids every merge with upstream
 * colliding on the same file again.
 *
 * Each dependency is optional and answers 501 when missing, so the service
 * still starts in an environment without Finturu credentials.
 */
export function finturuRouter(deps: FinturuRouterDeps): Router {
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

  router.get('/cases/directory/finturu', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.getFinturuDirectory) {
      res.status(501).json({ message: 'Directory service is not enabled' });
      return;
    }
    // Read from the local copy, so there is a real total, search, and offset.
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const view = await deps.getFinturuDirectory({ auth, limit, offset, search });
    const sync = deps.directorySyncScheduler?.status;

    res.status(200).json({
      customers: view.customers,
      total: view.total,
      syncedAt: view.syncedAt,
      // The screen needs to tell "there is still no data" from "it is still
      // being fetched" so it does not show an emptiness that looks like an
      // error.
      syncing: sync?.running ?? false,
      syncError: sync?.lastError ?? null,
    });
  });

  /**
   * Forces a refresh. The directory already maintains itself; this exists for
   * operations and tests, not as part of the normal flow. It answers as soon
   * as it starts because the walk takes minutes.
   */
  router.post('/cases/directory/finturu/sync', async (req, res) => {
    requireAuthContext(req);
    if (!deps.directorySyncScheduler) {
      res.status(501).json({ message: 'Directory sync is not enabled' });
      return;
    }
    void deps.directorySyncScheduler.run();
    res.status(202).json({ started: true });
  });

  router.post('/cases/open-from-customer', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.openFraudCase) {
      res.status(501).json({ message: 'Open case service is not enabled' });
      return;
    }
    const {
      customerId,
      customerEmail,
      bridgeUserId,
      bridgeWallet,
      stripeCustomerId,
      riskScore,
      priority,
      reason,
      tags,
      assignedTo,
      autoAssignToMe,
      rawSnapshot,
    } = req.body ?? {};

    if (!customerId || !rawSnapshot) {
      res.status(400).json({ message: 'customerId and rawSnapshot are required' });
      return;
    }

    const kase = await deps.openFraudCase({
      auth,
      customerId,
      customerEmail,
      bridgeUserId,
      bridgeWallet,
      stripeCustomerId,
      riskScore: riskScore ? Number(riskScore) : undefined,
      priority: typeof priority === 'string' ? priority : undefined,
      reason: typeof reason === 'string' ? reason : undefined,
      tags: Array.isArray(tags) ? tags : undefined,
      assignedTo: assignedTo && typeof assignedTo === 'object' ? assignedTo : undefined,
      autoAssignToMe: Boolean(autoAssignToMe),
      rawSnapshot,
    });

    res.status(201).json(toCaseResponse(kase));
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


  return router;
}

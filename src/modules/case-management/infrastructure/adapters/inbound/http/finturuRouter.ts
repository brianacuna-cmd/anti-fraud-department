import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createSyncFinturuDataUseCase } from '../../../../application/SyncFinturuData.js';
import type { createGetFinturuDirectoryUseCase } from '../../../../application/GetFinturuDirectory.js';
import type { createGetCaseCustomerSnapshotUseCase } from '../../../../application/GetCaseCustomerSnapshot.js';
import type { createOpenFraudCaseUseCase } from '../../../../application/OpenFraudCaseFromCustomer.js';
import type { FinturuApiClient } from '../../outbound/finturu/FinturuApiClient.js';
import { toCaseResponse } from './mappers/CaseHttpMapper.js';

export interface FinturuRouterDeps {
  readonly syncFinturuData?: ReturnType<typeof createSyncFinturuDataUseCase>;
  readonly getFinturuDirectory?: ReturnType<typeof createGetFinturuDirectoryUseCase>;
  readonly getCaseCustomerSnapshot?: ReturnType<typeof createGetCaseCustomerSnapshotUseCase>;
  readonly openFraudCase?: ReturnType<typeof createOpenFraudCaseUseCase>;
  readonly finturuClient?: FinturuApiClient;
}

/**
 * Rutas propias de la integracion con Finturu: consultas en vivo a los
 * proveedores (Bridge, Stripe), el padron de clientes y la apertura de
 * expediente desde un cliente del padron.
 *
 * Va en un router aparte —y no dentro de `caseRouter`— por la misma razon que
 * upstream separo `caseExportRouter`, `noteRouter` o `routingRuleRouter`: son
 * rutas que este fork anade sobre el modulo, y mantenerlas fuera del router
 * comun evita que cada merge con upstream vuelva a chocar en el mismo archivo.
 *
 * Cada dependencia es opcional y responde 501 cuando falta, de modo que el
 * servicio arranca igual en un entorno sin credenciales de Finturu.
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
    /*
     * El padrón se compone en vivo y se filtra en memoria: Finturu devuelve
     * `/customers` entero e ignora `search`, `limit` y `offset`, así que el
     * total real, la búsqueda y el desplazamiento los resuelve
     * `FinturuLiveDirectory`.
     */
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const view = await deps.getFinturuDirectory({ auth, limit, offset, search });

    res.status(200).json({
      customers: view.customers,
      total: view.total,
      // Cuándo se compuso lo que se está viendo. Ya no hay un sync que pueda
      // estar «en curso» ni fallar por su cuenta: si Finturu no responde, esta
      // misma petición falla y el frontend lo trata como cualquier otro error.
      syncedAt: view.syncedAt,
    });
  });

  /**
   * Los datos del cliente del expediente, compuestos ahora.
   *
   * Es lo que la ficha leía de `case.finturuCacheSnapshot` antes de que ese
   * campo dejara de guardarse. Ruta propia y no un campo más de `GET
   * /cases/:id` a propósito: la lista de expedientes pide docenas de casos de
   * golpe y ninguno necesita los movimientos del cliente; solo los necesita la
   * ficha abierta, y solo cuando se abre.
   */
  router.get('/cases/:caseId/customer-snapshot', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.getCaseCustomerSnapshot) {
      res.status(501).json({ message: 'Directory service is not enabled' });
      return;
    }
    const view = await deps.getCaseCustomerSnapshot({ auth, caseId: req.params.caseId! });
    res.status(200).json(view);
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

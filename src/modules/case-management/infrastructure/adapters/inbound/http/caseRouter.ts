import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateCaseUseCase } from '../../../../application/CreateCase.js';
import type { createListCasesUseCase } from '../../../../application/ListCases.js';
import type { createGetCaseUseCase } from '../../../../application/GetCase.js';
import type { createTransitionCaseStatusUseCase } from '../../../../application/TransitionCaseStatus.js';
import type { createGetCaseTimelineUseCase } from '../../../../application/GetCaseTimeline.js';
import type { createSyncFinturuDataUseCase } from '../../../../application/SyncFinturuData.js';
import type { createGetFinturuDirectoryUseCase } from '../../../../application/GetFinturuDirectory.js';
import type { DirectorySyncScheduler } from '../../../../application/DirectorySyncScheduler.js';
import type { createOpenFraudCaseUseCase } from '../../../../application/OpenFraudCaseFromCustomer.js';
import type { createAssignCaseUseCase } from '../../../../application/AssignCase.js';
import type { createReclassifyCaseUseCase } from '../../../../application/ReclassifyCase.js';
import type { createReopenCaseUseCase } from '../../../../application/ReopenCase.js';
import type { createExportCasesUseCase } from '../../../../application/ExportCases.js';
import type { createBulkCaseActionUseCase } from '../../../../application/BulkCaseAction.js';
import type {
  createListCaseRoutingRulesUseCase,
  createSetCaseRoutingRuleStatusUseCase,
  createUpsertCaseRoutingRuleUseCase,
} from '../../../../application/ManageCaseRoutingRules.js';
import type { FinturuApiClient } from '../../outbound/finturu/FinturuApiClient.js';
import {
  bulkCaseActionSchema,
  createCaseSchema,
  reclassifyCaseSchema,
  reopenCaseSchema,
  setRoutingRuleStatusSchema,
  upsertRoutingRuleSchema,
} from './dto/caseSchemas.js';
import { toCaseResponse } from './mappers/CaseHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface CaseRouterDeps {
  readonly createCase: ReturnType<typeof createCreateCaseUseCase>;
  readonly listCases: ReturnType<typeof createListCasesUseCase>;
  readonly getCase: ReturnType<typeof createGetCaseUseCase>;
  readonly transitionCaseStatus: ReturnType<typeof createTransitionCaseStatusUseCase>;
  readonly getCaseTimeline: ReturnType<typeof createGetCaseTimelineUseCase>;
  readonly syncFinturuData?: ReturnType<typeof createSyncFinturuDataUseCase>;
  readonly getFinturuDirectory?: ReturnType<typeof createGetFinturuDirectoryUseCase>;
  readonly directorySyncScheduler?: DirectorySyncScheduler;
  readonly openFraudCase?: ReturnType<typeof createOpenFraudCaseUseCase>;
  readonly assignCase?: ReturnType<typeof createAssignCaseUseCase>;
  readonly reclassifyCase?: ReturnType<typeof createReclassifyCaseUseCase>;
  readonly reopenCase?: ReturnType<typeof createReopenCaseUseCase>;
  readonly exportCases?: ReturnType<typeof createExportCasesUseCase>;
  readonly bulkCaseAction?: ReturnType<typeof createBulkCaseActionUseCase>;
  readonly upsertRoutingRule?: ReturnType<typeof createUpsertCaseRoutingRuleUseCase>;
  readonly listRoutingRules?: ReturnType<typeof createListCaseRoutingRulesUseCase>;
  readonly setRoutingRuleStatus?: ReturnType<typeof createSetCaseRoutingRuleStatusUseCase>;
  readonly finturuClient?: FinturuApiClient;
}

/** `?status=OPEN&status=IN_REVIEW` and `?status=OPEN,IN_REVIEW` both mean the same thing. */
function csvList(value: unknown): readonly string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const items = raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return items.length > 0 ? items : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * `Number(undefined)` is `NaN` and `Number('')` is `0` — both would silently
 * become a filter nobody asked for, so an unparseable value is dropped rather
 * than coerced.
 */
function num(value: unknown): number | undefined {
  const parsed = Number(str(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Maps CASE-004's query string onto the use case's input. Deliberately does
 * NOT read `organizationId`: tenant scope is derived from the auth context
 * inside the use case, and accepting it here would let any caller read
 * another tenant's cases.
 */
function parseCaseListQuery(query: Record<string, unknown>) {
  return {
    limit: num(query.limit),
    cursor: str(query.cursor),
    status: csvList(query.status),
    priority: csvList(query.priority),
    assignedToId: str(query.assignedToId),
    assignedToType: str(query.assignedToType),
    tags: csvList(query.tags),
    riskScoreMin: num(query.riskScoreMin),
    riskScoreMax: num(query.riskScoreMax),
    createdFrom: str(query.createdFrom),
    createdTo: str(query.createdTo),
    dueBefore: str(query.dueBefore),
    overdueOnly: str(query.overdueOnly) === 'true',
    search: str(query.search),
  };
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

  router.get('/cases/directory/finturu', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.getFinturuDirectory) {
      res.status(501).json({ message: 'Directory service is not enabled' });
      return;
    }
    // Se lee de la copia local, así que hay total real, búsqueda y offset.
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const view = await deps.getFinturuDirectory({ auth, limit, offset, search });
    const sync = deps.directorySyncScheduler?.status;

    res.status(200).json({
      customers: view.customers,
      total: view.total,
      syncedAt: view.syncedAt,
      // La pantalla necesita distinguir "todavía no hay datos" de "aún se
      // están trayendo" para no mostrar un vacío que parece un error.
      syncing: sync?.running ?? false,
      syncError: sync?.lastError ?? null,
    });
  });

  /**
   * Fuerza un refresco. El directorio ya se mantiene solo; esto existe para
   * operación y pruebas, no como parte del flujo normal. Responde en cuanto
   * arranca porque el recorrido tarda minutos.
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

  router.post('/cases', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createCaseSchema, req.body);
    const kase = await deps.createCase({ auth, ...body });
    res.status(201).json(toCaseResponse(kase));
  });

  router.get('/cases', async (req, res) => {
    const auth = requireAuthContext(req);
    const page = await deps.listCases({ auth, ...parseCaseListQuery(req.query) });
    res.status(200).json({
      items: page.items.map(toCaseResponse),
      nextCursor: page.nextCursor,
    });
  });

  // Declarada antes que '/cases/:id': Express resuelve por orden y, si fuese
  // despues, la palabra "export" se interpretaria como el id de un caso.
  router.get('/cases/export', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.exportCases) return res.status(501).json({ message: 'Export not available' });
    const { limit: _limit, cursor: _cursor, ...filters } = parseCaseListQuery(req.query);
    const result = await deps.exportCases({ auth, ...filters });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Total-Rows', String(result.rowCount));
    if (result.truncated) res.setHeader('X-Result-Truncated', 'true');
    res.status(200).send(result.csv);
  });

  // Igual que '/cases/export': declarada antes que las rutas con ':id' para
  // que Express no lea "bulk-action" como el identificador de un caso.
  router.post('/cases/bulk-action', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.bulkCaseAction) return res.status(501).json({ message: 'Bulk actions not available' });
    const body = parseRequest(bulkCaseActionSchema, req.body);
    const result = await deps.bulkCaseAction({
      auth,
      caseIds: body.caseIds,
      action: body.action,
      assignedTo: body.assignedTo ?? null,
      priority: body.priority,
      tags: body.tags,
    });

    // 207: el lote no es un exito ni un fallo unico. Devolver 200 cuando la
    // mitad fallo haria que la interfaz cantase victoria sobre casos intactos.
    res.status(result.failed > 0 ? 207 : 200).json(result);
  });

  // Reglas de enrutamiento (CASE-002). Declaradas antes que las rutas con
  // ':id', igual que '/cases/export' y '/cases/bulk-action'.
  const toRoutingRuleResponse = (rule: {
    id: string;
    name: string;
    evaluationOrder: number;
    conditions: unknown;
    assignTo: { type: string; id: string };
    status: string;
    createdAt: string;
    updatedAt: string;
  }) => ({
    id: rule.id,
    name: rule.name,
    evaluationOrder: rule.evaluationOrder,
    conditions: rule.conditions,
    assignTo: rule.assignTo,
    status: rule.status,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  });

  router.get('/cases/routing-rules', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.listRoutingRules) return res.status(501).json({ message: 'Routing rules not available' });
    const rules = await deps.listRoutingRules({ auth });
    res.status(200).json({ items: rules.map(toRoutingRuleResponse) });
  });

  router.post('/cases/routing-rules', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.upsertRoutingRule) return res.status(501).json({ message: 'Routing rules not available' });
    const body = parseRequest(upsertRoutingRuleSchema, req.body);
    const rule = await deps.upsertRoutingRule({ auth, ...body });
    res.status(201).json(toRoutingRuleResponse(rule));
  });

  router.put('/cases/routing-rules/:ruleId', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.upsertRoutingRule) return res.status(501).json({ message: 'Routing rules not available' });
    const body = parseRequest(upsertRoutingRuleSchema, req.body);
    const rule = await deps.upsertRoutingRule({ auth, ruleId: req.params.ruleId!, ...body });
    res.status(200).json(toRoutingRuleResponse(rule));
  });

  router.patch('/cases/routing-rules/:ruleId/status', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.setRoutingRuleStatus) return res.status(501).json({ message: 'Routing rules not available' });
    const body = parseRequest(setRoutingRuleStatusSchema, req.body);
    const rule = await deps.setRoutingRuleStatus({ auth, ruleId: req.params.ruleId!, status: body.status });
    res.status(200).json(toRoutingRuleResponse(rule));
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

  router.patch('/cases/:id/assign', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.assignCase) {
      res.status(501).json({ message: 'Assign service is not enabled' });
      return;
    }
    const body = req.body as { assignedTo?: { type: string; id: string } | null; userId?: string | null; roleId?: string | null };
    let assignedTo = body.assignedTo ?? null;
    if (!assignedTo && body.userId) {
      assignedTo = { type: 'USER', id: body.userId };
    } else if (!assignedTo && body.roleId) {
      assignedTo = { type: 'ROLE', id: body.roleId };
    }
    const kase = await deps.assignCase({ auth, caseId: req.params.id!, assignedTo });
    res.status(200).json(toCaseResponse(kase));
  });

  router.patch('/cases/:id/priority-tags', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.reclassifyCase) return res.status(501).json({ message: 'Reclassify case not available' });
    const body = parseRequest(reclassifyCaseSchema, req.body);
    const kase = await deps.reclassifyCase({
      auth,
      caseId: req.params.id!,
      priority: body.priority,
      tags: body.tags,
    });
    res.status(200).json(toCaseResponse(kase));
  });

  router.post('/cases/:id/reopen', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.reopenCase) return res.status(501).json({ message: 'Reopen case not available' });
    const body = parseRequest(reopenCaseSchema, req.body ?? {});
    const kase = await deps.reopenCase({
      auth,
      caseId: req.params.id!,
      nextStatus: body.nextStatus,
      reason: body.reason,
    });
    res.status(200).json(toCaseResponse(kase));
  });

  router.get('/cases/:id/timeline', async (req, res) => {
    const auth = requireAuthContext(req);
    const events = await deps.getCaseTimeline({ auth, caseId: req.params.id! });
    res.status(200).json(
      events.map(({ event, createdByName, createdByKind }) => ({
        id: event.id,
        caseId: event.caseId,
        eventType: event.eventType,
        previousValue: event.previousValue,
        newValue: event.newValue,
        createdBy: event.createdBy,
        createdByName,
        createdByKind,
        createdAt: event.createdAt,
      }))
    );
  });

  return router;
}


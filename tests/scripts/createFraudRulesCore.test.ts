import type { Server } from 'node:http';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { oid } from '../support/oid.js';
import {
  FRAUD_RULES_NAME,
  FRAUD_RULE_FACTORS,
  runCreateFraudRules,
} from '../../scripts/createFraudRulesCore.js';
import { createApp } from '../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../src/shared/http/requestAuthContext.js';
import { createAuthContext } from '../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../src/shared/time/Instant.js';
import { riskAssessmentErrorStatus } from '../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/errorStatus.js';
import { scoringRuleRouter } from '../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/scoringRuleRouter.js';
import { createCreateScoringRuleUseCase } from '../../src/modules/risk-assessment/application/CreateScoringRule.js';
import { createActivateScoringRuleUseCase } from '../../src/modules/risk-assessment/application/ActivateScoringRule.js';
import { createListScoringRulesUseCase } from '../../src/modules/risk-assessment/application/ListScoringRules.js';
import { createGetScoringRuleUseCase } from '../../src/modules/risk-assessment/application/GetScoringRule.js';
import { createSimulateScoringRuleUseCase } from '../../src/modules/risk-assessment/application/SimulateScoringRule.js';
import { createDeleteScoringRuleUseCase } from '../../src/modules/risk-assessment/application/DeleteScoringRule.js';
import { createUpdateScoringRuleUseCase } from '../../src/modules/risk-assessment/application/UpdateScoringRule.js';
import { ZenRiskScoringEngine } from '../../src/modules/risk-assessment/infrastructure/adapters/outbound/zen/ZenRiskScoringEngine.js';
import { generateRiskScoringRuleId } from '../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { buildFactorScoringJdm } from '../../src/modules/risk-assessment/domain/services/factorScoringJdm.js';
import { InMemoryRiskScoringRuleRepository } from '../helpers/risk-assessment/InMemoryRiskScoringRuleRepository.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../src/modules/risk-assessment/infrastructure/PassthroughUnitOfWork.js';

const NOW = fromDate(new Date('2026-09-15T00:00:00.000Z'));
const SUPERVISOR = createAuthContext({ userId: oid('sup'), organizationId: oid('org-1'), roleId: 'SUPERVISOR', actorType: 'USER' });

/** The real scoring rule routes on a real port: the script talks HTTP to them exactly as it would to the API. */
async function startApi() {
  const scoringRules = new InMemoryRiskScoringRuleRepository();
  const auditRecorder = new InMemoryRiskAssessmentAuditRecorder();
  const clock = { now: () => NOW };
  const unitOfWork = new PassthroughUnitOfWork();
  const engine = new ZenRiskScoringEngine();
  const api = Router();
  api.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, SUPERVISOR);
    next();
  });
  api.use(
    scoringRuleRouter({
      createScoringRule: createCreateScoringRuleUseCase({ scoringRules, auditRecorder, clock, generateRiskScoringRuleId }),
      activateScoringRule: createActivateScoringRuleUseCase({ scoringRules, unitOfWork, auditRecorder, clock }),
      listScoringRules: createListScoringRulesUseCase({ scoringRules }),
      getScoringRule: createGetScoringRuleUseCase({ scoringRules }),
      updateScoringRule: createUpdateScoringRuleUseCase({ scoringRules, unitOfWork, auditRecorder, clock }),
      deleteScoringRule: createDeleteScoringRuleUseCase({ scoringRules, auditRecorder, unitOfWork, clock }),
      simulateScoringRule: createSimulateScoringRuleUseCase({ simulationEngine: engine, auditRecorder }),
    }),
  );
  const app = createApp({ routers: [{ path: '/api/v1', router: api }], errorHandler: createErrorHandler(riskAssessmentErrorStatus) });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as { port: number };
  return {
    apiUrl: `http://127.0.0.1:${port}/api/v1`,
    scoringRules,
    close: async () => {
      engine.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('runCreateFraudRules', () => {
  let api: Awaited<ReturnType<typeof startApi>>;

  beforeEach(async () => {
    api = await startApi();
  });

  afterEach(async () => {
    await api.close();
  });

  const run = (confirm: boolean, log: string[] = []) =>
    runCreateFraudRules({ apiUrl: api.apiUrl, token: 't', confirm, fetch: (url, init) => fetch(url, init), log: (l) => log.push(l) });

  it('writes nothing without --confirm', async () => {
    const result = await run(false);

    expect(result).toEqual({ outcome: 'DRY_RUN', currentActive: null });
    expect(api.scoringRules.all()).toHaveLength(0);
  });

  it('creates every rule as one MAX rule, activates it, and does nothing on a second run', async () => {
    const first = await run(true);
    const second = await run(true);

    expect(first.outcome).toBe('ACTIVATED');
    expect(second).toEqual({ outcome: 'ALREADY_ACTIVE', ruleId: (first as { ruleId: string }).ruleId });
    const rules = api.scoringRules.all();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ name: FRAUD_RULES_NAME, status: 'ACTIVE' });
  });
});

describe('FRAUD_RULE_FACTORS evaluated by ZEN', () => {
  const engine = new ZenRiskScoringEngine();
  const graph = buildFactorScoringJdm(FRAUD_RULE_FACTORS, 'MAX');
  afterAll(() => engine.dispose());

  const event = (activity: Record<string, number>) => ({
    provider: 'stripe',
    amountCents: 1_000,
    currency: 'USD',
    riskSignals: {},
    activity,
  });

  it.each([
    ['Geo dispersa', { distinctCardCountries24h: 2 }, 60],
    ['Seller reincidente', { merchantLinksWithRepeatedFailures: 3 }, 75],
    ['Velocidad', { failedAttempts10m: 5 }, 80],
    ['Link expira', { linkSuspiciousDeclines: 3 }, 85],
    ['Card testing', { linkDistinctCards: 3 }, 90],
    ['Chargeback', { chargebacks90d: 1 }, 95],
    ['Bridge · Destinos distintos', { distinctCounterparties7d: 3 }, 60],
    ['Bridge · Ráfaga', { transfers24h: 5 }, 65],
    ['Bridge · Transferencia grande', { currentTransferCents: 1_000_000 }, 70],
    ['Bridge · Volumen diario', { transferVolume24hCents: 2_500_000 }, 75],
    ['Bridge · Destino nuevo', { newCounterpartyTransferCents: 500_000 }, 80],
  ])('%s alone scores its points', async (_name, activity, points) => {
    expect((await engine.evaluate(graph, event(activity))).riskScore).toBe(points);
  });

  it('scores 0 just below every threshold, and the gravest rule when several hold', async () => {
    const below = {
      distinctCardCountries24h: 1,
      merchantLinksWithRepeatedFailures: 2,
      failedAttempts10m: 4,
      linkSuspiciousDeclines: 2,
      linkDistinctCards: 2,
      chargebacks90d: 0,
      distinctCounterparties7d: 2,
      transfers24h: 4,
      currentTransferCents: 999_999,
      transferVolume24hCents: 2_499_999,
      newCounterpartyTransferCents: 499_999,
    };
    expect((await engine.evaluate(graph, event(below))).riskScore).toBe(0);

    const several = await engine.evaluate(graph, event({ ...below, distinctCardCountries24h: 4, chargebacks90d: 2 }));
    expect(several.riskScore).toBe(95);
    expect(several.hits).toHaveLength(2);
  });
});

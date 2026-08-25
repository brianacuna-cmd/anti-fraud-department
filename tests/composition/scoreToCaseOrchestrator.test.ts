import { oid } from '../support/oid.js';
import { createAuthContext } from '../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../src/shared/time/Instant.js';
import { createScoreToCaseOrchestrator } from '../../src/composition/scoreToCaseOrchestrator.js';
import type { CanonicalRiskEvent } from '../../src/modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import type { CalculateRiskScoreResult } from '../../src/modules/risk-assessment/application/CalculateRiskScore.js';
import { OrganizationFraudConfig } from '../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { generateOrganizationFraudConfigId } from '../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { Case } from '../../src/modules/case-management/domain/model/aggregates/Case.js';
import { generateCaseId } from '../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { CaseManagementError } from '../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { RiskAssessmentError } from '../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const AUTH = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
});

function buildEvent(overrides: Partial<CanonicalRiskEvent> = {}): CanonicalRiskEvent {
  return {
    provider: 'stripe',
    providerEventType: 'CHARGEBACK',
    caseCustomerId: 'cust-1',
    amountCents: 2500,
    currency: 'USD',
    riskSignals: { providerRiskScore: 80 },
    createdAt: NOW,
    rawPayload: { secret: 'do-not-freeze' },
    ...overrides,
  };
}

function buildConfig(
  overrides: Partial<Parameters<typeof OrganizationFraudConfig.create>[0]> = {},
): OrganizationFraudConfig {
  return OrganizationFraudConfig.create({
    id: generateOrganizationFraudConfigId(),
    organizationId: oid('org-1'),
    slaLowMinutes: 240,
    slaMediumMinutes: 120,
    slaHighMinutes: 60,
    slaCriticalMinutes: 30,
    riskThresholdLow: 25,
    riskThresholdMedium: 50,
    riskThresholdHigh: 75,
    riskThresholdCritical: 90,
    featureFlags: {},
    now: NOW,
    ...overrides,
  });
}

function stubCase(priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', snapshot: Record<string, unknown> | null): Case {
  return Case.create({
    id: generateCaseId(),
    organizationId: oid('org-1'),
    customerId: 'cust-1',
    riskScore: createRiskScore(80),
    priority,
    scoringEvidence: snapshot,
    now: NOW,
  });
}

describe('createScoreToCaseOrchestrator', () => {
  it('opens a case with highest-band priority and freezes snapshot (sans rawPayload) when score ≥ low', async () => {
    const event = buildEvent();
    const scoreResult: CalculateRiskScoreResult = {
      riskScore: 88 as CalculateRiskScoreResult['riskScore'],
      ruleId: oid('rule-1') as CalculateRiskScoreResult['ruleId'],
      name: 'active-rule',
      conditionsVersion: 2,
      hits: [{ id: 'hit-a', points: 10 }],
    };
    const createCaseCalls: unknown[] = [];
    let created: Case | undefined;

    const process = createScoreToCaseOrchestrator({
      calculateRiskScore: async () => scoreResult,
      getOrganizationFraudConfig: async () => buildConfig(),
      createCase: async (input) => {
        createCaseCalls.push(input);
        created = stubCase('HIGH', (input.scoringEvidence as Record<string, unknown>) ?? null);
        return created;
      },
    });

    const result = await process({ auth: AUTH, event });

    expect(result.opened).toBe(true);
    expect(result.riskScore).toBe(88);
    expect(result.priority).toBe('HIGH');
    expect(result.caseId).toBe(created!.id);
    expect(createCaseCalls).toHaveLength(1);
    const call = createCaseCalls[0] as {
      customerId: string;
      riskScore: number;
      priority: string;
      scoringEvidence: Record<string, unknown>;
    };
    expect(call.customerId).toBe('cust-1');
    expect(call.riskScore).toBe(88);
    expect(call.priority).toBe('HIGH');
    expect(call.scoringEvidence).toEqual({
      event: {
        provider: 'stripe',
        providerEventType: 'CHARGEBACK',
        caseCustomerId: 'cust-1',
        amountCents: 2500,
        currency: 'USD',
        riskSignals: { providerRiskScore: 80 },
        createdAt: NOW,
      },
      ruleId: oid('rule-1'),
      conditionsVersion: 2,
      riskScore: 88,
      hits: [{ id: 'hit-a', points: 10 }],
    });
    expect(call.scoringEvidence.event).not.toHaveProperty('rawPayload');
  });

  it('does not call CreateCase when score is below risk_threshold_low', async () => {
    const createCase = jest.fn();
    const process = createScoreToCaseOrchestrator({
      calculateRiskScore: async () =>
        ({
          riskScore: 10 as CalculateRiskScoreResult['riskScore'],
          ruleId: oid('rule-1') as CalculateRiskScoreResult['ruleId'],
          name: 'active-rule',
          conditionsVersion: 1,
          hits: [],
        }) satisfies CalculateRiskScoreResult,
      getOrganizationFraudConfig: async () => buildConfig(),
      createCase,
    });

    const result = await process({ auth: AUTH, event: buildEvent() });

    expect(result).toEqual({
      riskScore: 10,
      ruleId: oid('rule-1'),
      conditionsVersion: 1,
      opened: false,
    });
    expect(createCase).not.toHaveBeenCalled();
  });

  it('maps CRITICAL when score crosses the critical band', async () => {
    const createCaseCalls: Array<{ priority?: string }> = [];
    const process = createScoreToCaseOrchestrator({
      calculateRiskScore: async () =>
        ({
          riskScore: 95 as CalculateRiskScoreResult['riskScore'],
          ruleId: oid('rule-1') as CalculateRiskScoreResult['ruleId'],
          name: 'active-rule',
          conditionsVersion: 1,
          hits: [],
        }) satisfies CalculateRiskScoreResult,
      getOrganizationFraudConfig: async () => buildConfig(),
      createCase: async (input) => {
        createCaseCalls.push(input);
        return stubCase('CRITICAL', null);
      },
    });

    const result = await process({ auth: AUTH, event: buildEvent() });

    expect(result.opened).toBe(true);
    expect(result.priority).toBe('CRITICAL');
    expect(createCaseCalls[0]?.priority).toBe('CRITICAL');
  });

  it('fail-closes when OrganizationFraudConfig is missing (does not open a case)', async () => {
    const createCase = jest.fn();
    const process = createScoreToCaseOrchestrator({
      calculateRiskScore: async () =>
        ({
          riskScore: 80 as CalculateRiskScoreResult['riskScore'],
          ruleId: oid('rule-1') as CalculateRiskScoreResult['ruleId'],
          name: 'active-rule',
          conditionsVersion: 1,
          hits: [],
        }) satisfies CalculateRiskScoreResult,
      getOrganizationFraudConfig: async () => {
        throw new CaseManagementError('ORGANIZATION_FRAUD_CONFIG_NOT_FOUND', 'missing');
      },
      createCase,
    });

    await expect(process({ auth: AUTH, event: buildEvent() })).rejects.toMatchObject({
      code: 'ORGANIZATION_FRAUD_CONFIG_NOT_FOUND',
    });
    expect(createCase).not.toHaveBeenCalled();
  });

  it('fail-closes when no ACTIVE scoring rule exists', async () => {
    const createCase = jest.fn();
    const getConfig = jest.fn();
    const process = createScoreToCaseOrchestrator({
      calculateRiskScore: async () => {
        throw new RiskAssessmentError('SCORING_RULE_NOT_FOUND', 'no active rule');
      },
      getOrganizationFraudConfig: getConfig,
      createCase,
    });

    await expect(process({ auth: AUTH, event: buildEvent() })).rejects.toMatchObject({
      code: 'SCORING_RULE_NOT_FOUND',
    });
    expect(getConfig).not.toHaveBeenCalled();
    expect(createCase).not.toHaveBeenCalled();
  });

  it('strips subjectIdentity PII from scoringEvidence while keeping other event fields', async () => {
    const event = buildEvent({
      subjectIdentity: {
        nombre: 'John Doe',
        documento: '123456789',
        walletAddress: '0xabc',
        entryType: 'PERSON',
      },
    });
    const scoreResult: CalculateRiskScoreResult = {
      riskScore: 88 as CalculateRiskScoreResult['riskScore'],
      ruleId: oid('rule-1') as CalculateRiskScoreResult['ruleId'],
      name: 'active-rule',
      conditionsVersion: 2,
      hits: [],
    };
    const createCaseCalls: unknown[] = [];
    const process = createScoreToCaseOrchestrator({
      calculateRiskScore: async () => scoreResult,
      getOrganizationFraudConfig: async () => buildConfig(),
      createCase: async (input) => {
        createCaseCalls.push(input);
        return stubCase('HIGH', (input.scoringEvidence as Record<string, unknown>) ?? null);
      },
    });

    await process({ auth: AUTH, event });

    const call = createCaseCalls[0] as { scoringEvidence: Record<string, unknown> };
    const persistedEvent = call.scoringEvidence.event as Record<string, unknown>;
    expect(persistedEvent).not.toHaveProperty('subjectIdentity');
    expect(persistedEvent).not.toHaveProperty('nombre');
    expect(persistedEvent).not.toHaveProperty('documento');
    expect(persistedEvent).not.toHaveProperty('walletAddress');
    expect(persistedEvent.provider).toBe('stripe');
    expect(persistedEvent.caseCustomerId).toBe('cust-1');
  });

  it('freezes hits as [] when engine omitted hits evidence', async () => {
    const createCaseCalls: Array<{
      priority?: string;
      scoringEvidence?: Record<string, unknown> | null;
    }> = [];
    const process = createScoreToCaseOrchestrator({
      calculateRiskScore: async () =>
        ({
          riskScore: 40 as CalculateRiskScoreResult['riskScore'],
          ruleId: oid('rule-1') as CalculateRiskScoreResult['ruleId'],
          name: 'active-rule',
          conditionsVersion: 1,
          hits: [],
        }) satisfies CalculateRiskScoreResult,
      getOrganizationFraudConfig: async () => buildConfig(),
      createCase: async (input) => {
        createCaseCalls.push(input);
        return stubCase('LOW', (input.scoringEvidence as Record<string, unknown>) ?? null);
      },
    });

    await process({ auth: AUTH, event: buildEvent({ rawPayload: undefined }) });

    expect(createCaseCalls[0]?.scoringEvidence?.hits).toEqual([]);
    expect(createCaseCalls[0]?.priority).toBe('LOW');
  });
});

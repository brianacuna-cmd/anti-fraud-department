import { oid } from '../support/oid.js';
import { createSarSourceVerifier } from '../../src/composition/sarSourceVerifier.js';
import { Case } from '../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { AnalystDecision } from '../../src/modules/case-management/domain/model/aggregates/AnalystDecision.js';
import { generateAnalystDecisionId } from '../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createAnalystDecisionType } from '../../src/modules/case-management/domain/model/value-objects/AnalystDecisionType.js';
import { InMemoryCaseRepository } from '../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryAnalystDecisionRepository } from '../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { AmlAlert } from '../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { generateAmlAlertId } from '../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createMatchScore } from '../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { createWatchlistEntryId } from '../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { InMemoryAmlAlertRepository } from '../helpers/screening/InMemoryAmlAlertRepository.js';
import { fromDate } from '../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const CASE_ID = oid('case-1');
const ALERT_ID = oid('alert-1');

function buildCase(): Case {
  return Case.create({
    id: createCaseId(CASE_ID),
    organizationId: ORG_1,
    customerId: 'customer-1',
    riskScore: createRiskScore(80),
    priority: 'HIGH',
    now: NOW,
  });
}

function buildAlert(): AmlAlert {
  return AmlAlert.create({
    id: generateAmlAlertId(),
    organizationId: ORG_1,
    customerId: 'customer-1',
    suspectedEntity: 'John Smith',
    confidence: createMatchScore(82),
    detectionSource: 'index',
    severity: 'HIGH',
    matchedEntry: createScreeningMatch({
      entryId: createWatchlistEntryId(oid('entry-1')),
      watchlistId: createWatchlistId(oid('watchlist-1')),
      name: 'John Smith',
      matchField: 'NAME',
      algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
    }),
    now: NOW,
  });
}

function build() {
  const cases = new InMemoryCaseRepository();
  const analystDecisions = new InMemoryAnalystDecisionRepository();
  const amlAlerts = new InMemoryAmlAlertRepository();
  const verifier = createSarSourceVerifier(cases, analystDecisions, amlAlerts);
  return { verifier, cases, analystDecisions, amlAlerts };
}

describe('createSarSourceVerifier — verifyCase', () => {
  it('elegible: el caso tiene una decisión FRAUD_CONFIRMED', async () => {
    const { verifier, cases, analystDecisions } = build();
    await cases.save(buildCase());
    await analystDecisions.save(
      AnalystDecision.create({
        id: generateAnalystDecisionId(),
        caseId: createCaseId(CASE_ID),
        organizationId: ORG_1,
        decision: createAnalystDecisionType('FRAUD_CONFIRMED'),
        confidence: 90,
        comment: 'confirmado',
        createdBy: oid('analyst-1'),
        now: NOW,
      }),
    );

    const result = await verifier.verifyCase(ORG_1, CASE_ID);
    expect(result).toEqual({ exists: true, eligible: true });
  });

  it('existe pero no elegible: el caso no tiene ninguna decisión FRAUD_CONFIRMED', async () => {
    const { verifier, cases, analystDecisions } = build();
    await cases.save(buildCase());
    await analystDecisions.save(
      AnalystDecision.create({
        id: generateAnalystDecisionId(),
        caseId: createCaseId(CASE_ID),
        organizationId: ORG_1,
        decision: createAnalystDecisionType('FALSE_POSITIVE'),
        confidence: 20,
        comment: 'benigno',
        createdBy: oid('analyst-1'),
        now: NOW,
      }),
    );

    const result = await verifier.verifyCase(ORG_1, CASE_ID);
    expect(result).toEqual({ exists: true, eligible: false });
  });

  it('no existe: caseId desconocido', async () => {
    const { verifier } = build();
    const result = await verifier.verifyCase(ORG_1, oid('missing'));
    expect(result).toEqual({ exists: false, eligible: false });
  });

  it('cross-tenant: el caso existe pero pertenece a otra organización', async () => {
    const { verifier, cases } = build();
    await cases.save(buildCase());

    const result = await verifier.verifyCase(ORG_2, CASE_ID);
    expect(result).toEqual({ exists: false, eligible: false });
  });

  it('id con formato inválido no revienta, solo dice "no existe"', async () => {
    const { verifier } = build();
    const result = await verifier.verifyCase(ORG_1, 'not-a-valid-id');
    expect(result).toEqual({ exists: false, eligible: false });
  });
});

describe('createSarSourceVerifier — verifyAmlAlert', () => {
  it('elegible: la alerta está RESOLVED (llegó ahí solo vía CONFIRMED_MATCH)', async () => {
    const { verifier, amlAlerts } = build();
    const resolved = buildAlert().transitionTo('INVESTIGATING', NOW).transitionTo('RESOLVED', NOW);
    await amlAlerts.save(resolved);

    const result = await verifier.verifyAmlAlert(ORG_1, resolved.id);
    expect(result).toEqual({ exists: true, eligible: true });
  });

  it('existe pero no elegible: la alerta sigue OPEN', async () => {
    const { verifier, amlAlerts } = build();
    const alert = buildAlert();
    await amlAlerts.save(alert);

    const result = await verifier.verifyAmlAlert(ORG_1, alert.id);
    expect(result).toEqual({ exists: true, eligible: false });
  });

  it('existe pero no elegible: la alerta se resolvió como FALSE_POSITIVE', async () => {
    const { verifier, amlAlerts } = build();
    const falsePositive = buildAlert().transitionTo('INVESTIGATING', NOW).transitionTo('FALSE_POSITIVE', NOW);
    await amlAlerts.save(falsePositive);

    const result = await verifier.verifyAmlAlert(ORG_1, falsePositive.id);
    expect(result).toEqual({ exists: true, eligible: false });
  });

  it('no existe: amlAlertId desconocido', async () => {
    const { verifier } = build();
    const result = await verifier.verifyAmlAlert(ORG_1, oid('missing'));
    expect(result).toEqual({ exists: false, eligible: false });
  });

  it('cross-tenant: la alerta existe pero pertenece a otra organización', async () => {
    const { verifier, amlAlerts } = build();
    const resolved = buildAlert().transitionTo('INVESTIGATING', NOW).transitionTo('RESOLVED', NOW);
    await amlAlerts.save(resolved);

    const result = await verifier.verifyAmlAlert(ORG_2, resolved.id);
    expect(result).toEqual({ exists: false, eligible: false });
  });
});

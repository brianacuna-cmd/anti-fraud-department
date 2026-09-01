import { oid } from '../support/oid.js';
import { createAuthContext } from '../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../src/shared/time/Instant.js';
import { createGetCaseAnalysisPack } from '../../src/composition/getCaseAnalysisPack.js';
import { createGetCaseUseCase } from '../../src/modules/case-management/application/GetCase.js';
import { createGetCaseTimelineUseCase } from '../../src/modules/case-management/application/GetCaseTimeline.js';
import { createListAmlAlertsUseCase } from '../../src/modules/screening/application/ListAmlAlerts.js';
import { Case } from '../../src/modules/case-management/domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../../src/modules/case-management/domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateTimelineEventId } from '../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryAmlAlertRepository } from '../helpers/screening/InMemoryAmlAlertRepository.js';
import { AmlAlert } from '../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { createAmlAlertId } from '../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../src/modules/screening/domain/model/entities/ScreeningMatch.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const AUTH = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });
const SUBJECT_ID = oid('case-subject');
const SNAPSHOT = { event: { caseCustomerId: 'cust-1' }, hits: [] };

function buildCase(id: string, extra: Partial<Parameters<typeof Case.create>[0]> = {}): Case {
  return Case.create({
    id: createCaseId(id),
    organizationId: extra.organizationId ?? ORG_1,
    customerId: extra.customerId ?? 'cust-1',
    riskScore: extra.riskScore ?? createRiskScore(50),
    priority: extra.priority ?? 'MEDIUM',
    finturuCacheSnapshot: extra.finturuCacheSnapshot ?? SNAPSHOT,
    now: extra.now ?? NOW,
    customerEmail: extra.customerEmail,
  });
}

function buildAlert(id: string, customerId: string, organizationId = ORG_1): AmlAlert {
  return AmlAlert.create({
    id: createAmlAlertId(id),
    organizationId,
    customerId,
    suspectedEntity: 'John Smith',
    confidence: createMatchScore(82),
    detectionSource: 'index',
    severity: 'HIGH',
    matchedEntry: createScreeningMatch({
      entryId: createWatchlistEntryId(oid(`entry-${id}`)),
      watchlistId: createWatchlistId(oid('watchlist-1')),
      name: 'John Smith',
      matchField: 'NAME',
      algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
    }),
    now: NOW,
  });
}

async function buildPack(seed: { cases: Case[]; alerts?: AmlAlert[]; timelineCaseId?: string }) {
  const cases = new InMemoryCaseRepository();
  const timeline = new InMemoryTimelineRecorder();
  const amlAlertRepository = new InMemoryAmlAlertRepository();
  await Promise.all(seed.cases.map((kase) => cases.save(kase)));
  await Promise.all((seed.alerts ?? []).map((alert) => amlAlertRepository.save(alert)));
  if (seed.timelineCaseId !== undefined) {
    await timeline.record(
      CaseTimelineEvent.create({
        id: generateTimelineEventId(),
        caseId: createCaseId(seed.timelineCaseId),
        eventType: 'CASE_CREATED',
        previousValue: null,
        newValue: 'OPEN',
        createdBy: oid('analyst-1'),
        createdAt: NOW,
      }),
    );
  }
  return createGetCaseAnalysisPack({
    getCase: createGetCaseUseCase({ cases }),
    getCaseTimeline: createGetCaseTimelineUseCase({ cases, timelineReader: timeline }),
    listAmlAlerts: createListAmlAlertsUseCase({ amlAlertRepository }),
    cases,
  });
}

describe('createGetCaseAnalysisPack', () => {
  it('returns composed facts without rawPayload, invented identity, or an agent brief', async () => {
    const getPack = await buildPack({
      cases: [buildCase(SUBJECT_ID), buildCase(oid('case-sib'))],
      alerts: [buildAlert(oid('aml-match'), 'cust-1'), buildAlert(oid('aml-other'), 'cust-other')],
      timelineCaseId: SUBJECT_ID,
    });
    const pack = await getPack({ auth: AUTH, caseId: SUBJECT_ID });
    expect(pack.case.id).toBe(SUBJECT_ID);
    expect(pack.timeline).toEqual([expect.objectContaining({ eventType: 'CASE_CREATED' })]);
    expect(pack.snapshot).toEqual(SNAPSHOT);
    expect(pack.snapshot).not.toHaveProperty('rawPayload');
    expect(pack.snapshot).not.toHaveProperty('subjectIdentity');
    expect(pack.amlAlerts).toEqual([expect.objectContaining({ customerId: 'cust-1' })]);
    expect(pack.relatedCases.map((item) => item.id)).toEqual([oid('case-sib')]);
    expect(pack.agentBrief).toBeNull();
  });

  it('throws the same 404/403 as GetCase', async () => {
    const missing = await buildPack({ cases: [] });
    await expect(missing({ auth: AUTH, caseId: oid('missing') })).rejects.toMatchObject({
      code: 'CASE_NOT_FOUND',
    });
    const foreign = await buildPack({
      cases: [buildCase(SUBJECT_ID, { organizationId: oid('org-2') })],
    });
    await expect(foreign({ auth: AUTH, caseId: SUBJECT_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN_CROSS_TENANT',
    });
  });

  it('returns an incomplete stored snapshot as stored', async () => {
    const incomplete = { frozen: true };
    const getPack = await buildPack({
      cases: [buildCase(SUBJECT_ID, { finturuCacheSnapshot: incomplete })],
    });
    const pack = await getPack({ auth: AUTH, caseId: SUBJECT_ID });
    expect(pack.snapshot).toEqual(incomplete);
    expect(pack.snapshot).not.toHaveProperty('rawPayload');
    expect(pack.snapshot).not.toHaveProperty('subjectIdentity');
  });

  it('excludes the current case from relatedCases and caps at 50', async () => {
    const siblings = Array.from({ length: 51 }, (_, index) => buildCase(oid(`sib-${index}`)));
    const getPack = await buildPack({ cases: [buildCase(SUBJECT_ID), ...siblings] });
    const pack = await getPack({ auth: AUTH, caseId: SUBJECT_ID });
    expect(pack.relatedCases).toHaveLength(50);
    expect(pack.relatedCases.some((item) => item.id === SUBJECT_ID)).toBe(false);
  });

  it('lists at most 100 AML alerts for the case customerId', async () => {
    const alerts = Array.from({ length: 101 }, (_, index) => buildAlert(oid(`aml-${index}`), 'cust-1'));
    const getPack = await buildPack({
      cases: [buildCase(SUBJECT_ID)],
      alerts: [...alerts, buildAlert(oid('aml-other'), 'cust-other')],
    });
    const pack = await getPack({ auth: AUTH, caseId: SUBJECT_ID });
    expect(pack.amlAlerts).toHaveLength(100);
    expect(pack.amlAlerts.every((alert) => alert.customerId === 'cust-1')).toBe(true);
  });
});

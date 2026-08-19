import { createGetCaseTimelineUseCase } from '../../../../src/modules/case-management/application/GetCaseTimeline.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../../../../src/modules/case-management/domain/model/aggregates/CaseTimelineEvent.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import type {
  AssigneeDirectory,
  ResolvedActor,
} from '../../../../src/modules/case-management/domain/ports/AssigneeDirectory.js';

const NOW = fromDate(new Date('2026-08-19T12:26:00.000Z'));
const ORG_1 = createAuthContext({ userId: 'analyst-1', organizationId: 'org-1', actorType: 'USER' });

/** Directorio de prueba: personas, la propia organizacion y un centinela. */
class FakeDirectory implements AssigneeDirectory {
  public lastCall: { organizationId: string; ids: readonly string[] } | null = null;
  public callCount = 0;

  private readonly known: Record<string, ResolvedActor> = {
    'user-santiago': { id: 'user-santiago', kind: 'USER', name: 'Santiago Celada' },
    'org-1': { id: 'org-1', kind: 'ORGANIZATION', name: 'Finturu Operaciones' },
    SYSTEM_WEBHOOK: { id: 'SYSTEM_WEBHOOK', kind: 'SYSTEM', name: 'Finturu (webhook)' },
  };

  async userExists(): Promise<boolean> {
    return true;
  }

  async roleExists(): Promise<boolean> {
    return true;
  }

  async resolveActors(organizationId: string, ids: readonly string[]): Promise<readonly ResolvedActor[]> {
    this.callCount += 1;
    this.lastCall = { organizationId, ids };
    return [...new Set(ids)].map(
      (id) => this.known[id] ?? { id, kind: 'UNKNOWN' as const, name: id },
    );
  }
}

function build(authors: (string | null)[], options: { withDirectory?: boolean } = {}) {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const directory = new FakeDirectory();

  const kase = Case.create({
    id: generateCaseId(),
    organizationId: 'org-1',
    customerId: 'customer-1',
    riskScore: createRiskScore(55),
    priority: createCasePriority('MEDIUM'),
    now: NOW,
  });
  void cases.save(kase);

  for (const createdBy of authors) {
    void timelineRecorder.record(
      CaseTimelineEvent.create({
        id: generateTimelineEventId(),
        caseId: kase.id,
        eventType: 'ASSIGNED',
        previousValue: null,
        newValue: 'USER:user-santiago',
        createdBy: createdBy as string,
        createdAt: NOW,
      }),
    );
  }

  const getCaseTimeline = createGetCaseTimelineUseCase({
    cases,
    timelineRecorder,
    assigneeDirectory: options.withDirectory === false ? undefined : directory,
  });

  return { kase, directory, getCaseTimeline };
}

describe('createGetCaseTimelineUseCase actor resolution', () => {
  it('resolves a person to their full name', async () => {
    const { kase, getCaseTimeline } = build(['user-santiago']);

    const [row] = await getCaseTimeline({ auth: ORG_1, caseId: kase.id });

    expect(row?.createdByName).toBe('Santiago Celada');
    expect(row?.createdByKind).toBe('USER');
  });

  it('resolves an ORGANIZATION actor, which the client cannot look up itself', async () => {
    // Un actor ORGANIZATION firma con el id del inquilino, y el panel no puede
    // traducirlo: GET /organizations/:id exige PLATFORM_ADMIN. Por eso lo
    // resuelve el backend.
    const { kase, getCaseTimeline } = build(['org-1']);

    const [row] = await getCaseTimeline({ auth: ORG_1, caseId: kase.id });

    expect(row?.createdByName).toBe('Finturu Operaciones');
    expect(row?.createdByKind).toBe('ORGANIZATION');
  });

  it('names the automated intake sentinel instead of leaking it raw', async () => {
    const { kase, getCaseTimeline } = build(['SYSTEM_WEBHOOK']);

    const [row] = await getCaseTimeline({ auth: ORG_1, caseId: kase.id });

    expect(row?.createdByName).toBe('Finturu (webhook)');
    expect(row?.createdByKind).toBe('SYSTEM');
  });

  it('falls back to the raw id rather than dropping an unresolvable author', async () => {
    const { kase, getCaseTimeline } = build(['b8636964deadbeef']);

    const [row] = await getCaseTimeline({ auth: ORG_1, caseId: kase.id });

    expect(row?.createdByName).toBe('b8636964deadbeef');
    expect(row?.createdByKind).toBe('UNKNOWN');
  });

  it('treats an unsigned event as system-generated, not as a failed lookup', async () => {
    const { kase, getCaseTimeline } = build([null]);

    const [row] = await getCaseTimeline({ auth: ORG_1, caseId: kase.id });

    expect(row?.createdByName).toBe('Sistema');
    expect(row?.createdByKind).toBe('SYSTEM');
  });

  it('resolves the whole timeline in one batched call, not once per event', async () => {
    const { kase, directory, getCaseTimeline } = build([
      'user-santiago',
      'user-santiago',
      'org-1',
      'SYSTEM_WEBHOOK',
      'user-santiago',
    ]);

    const rows = await getCaseTimeline({ auth: ORG_1, caseId: kase.id });

    expect(rows).toHaveLength(5);
    expect(directory.callCount).toBe(1);
    expect(directory.lastCall?.organizationId).toBe('org-1');
  });

  it('scopes resolution to the case organization, not the caller', async () => {
    const { kase, directory, getCaseTimeline } = build(['user-santiago']);

    await getCaseTimeline({ auth: ORG_1, caseId: kase.id });

    expect(directory.lastCall?.organizationId).toBe(kase.organizationId);
  });

  it('still returns events when no directory is wired', async () => {
    const { kase, getCaseTimeline } = build(['user-santiago'], { withDirectory: false });

    const [row] = await getCaseTimeline({ auth: ORG_1, caseId: kase.id });

    expect(row?.createdByName).toBe('user-santiago');
    expect(row?.event.eventType).toBe('ASSIGNED');
  });
});

import { createAssignCaseUseCase } from '../../../../src/modules/case-management/application/AssignCase.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import type { CaseNotification, Notifier } from '../../../../src/modules/case-management/domain/ports/Notifier.js';
import type { AssigneeDirectory, ResolvedActor } from '../../../../src/modules/case-management/domain/ports/AssigneeDirectory.js';

const NOW = fromDate(new Date('2026-11-03T10:00:00.000Z'));
const SUPERVISOR = createAuthContext({ userId: 'supervisor-1', organizationId: 'org-1', actorType: 'USER' });

class RecordingNotifier implements Notifier {
  public readonly sent: CaseNotification[] = [];
  async notify(notification: CaseNotification): Promise<void> {
    this.sent.push(notification);
  }
}

class AlwaysFound implements AssigneeDirectory {
  async userExists(): Promise<boolean> { return true; }
  async roleExists(): Promise<boolean> { return true; }
  async resolveActors(_o: string, ids: readonly string[]): Promise<readonly ResolvedActor[]> {
    return ids.map((id) => ({ id, kind: 'USER' as const, name: id }));
  }
}

function build(seedAssignee?: string) {
  const cases = new InMemoryCaseRepository();
  const notifier = new RecordingNotifier();

  let kase = Case.create({
    id: generateCaseId(),
    organizationId: 'org-1',
    customerId: 'customer-1',
    riskScore: createRiskScore(85),
    priority: createCasePriority('CRITICAL'),
    now: NOW,
  });
  if (seedAssignee) kase = kase.reassign(createAssignedTo('USER', seedAssignee), NOW);
  void cases.save(kase);

  const assignCase = createAssignCaseUseCase({
    cases,
    timelineRecorder: new InMemoryTimelineRecorder(),
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
    auditRecorder: new InMemoryCaseManagementAuditRecorder(),
    assigneeDirectory: new AlwaysFound(),
    notifier,
  });

  return { kase, notifier, assignCase };
}

describe('CASE-006 reassignment notification', () => {
  it('notifies the new assignee, naming the case and its severity', async () => {
    const { kase, notifier, assignCase } = build();

    await assignCase({ auth: SUPERVISOR, caseId: kase.id, assignedTo: { type: 'USER', id: 'analyst-9' } });

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatchObject({
      organizationId: 'org-1',
      recipientUserId: 'analyst-9',
      alertType: 'CASO_ASIGNADO',
      resourceType: 'case',
      resourceId: kase.id,
    });
    expect(notifier.sent[0]?.body).toContain('CRITICAL');
  });

  it('does not notify someone who assigned the case to themselves', async () => {
    // Acaba de hacerlo: ya lo sabe.
    const { kase, notifier, assignCase } = build();

    await assignCase({ auth: SUPERVISOR, caseId: kase.id, assignedTo: { type: 'USER', id: 'supervisor-1' } });

    expect(notifier.sent).toHaveLength(0);
  });

  it('does not notify when the case is released to the general inbox', async () => {
    // No hay destinatario a quien avisar.
    const { kase, notifier, assignCase } = build('analyst-9');

    await assignCase({ auth: SUPERVISOR, caseId: kase.id, assignedTo: null });

    expect(notifier.sent).toHaveLength(0);
  });

  it('does not notify when the assignee is a role', async () => {
    // Un rol no tiene bandeja: avisar a "ANALYST" no llegaria a nadie concreto.
    const { kase, notifier, assignCase } = build();

    await assignCase({ auth: SUPERVISOR, caseId: kase.id, assignedTo: { type: 'ROLE', id: 'ANALYST' } });

    expect(notifier.sent).toHaveLength(0);
  });
});

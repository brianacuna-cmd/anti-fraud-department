import { oid } from '../../../support/oid.js';
import { createAddCaseNoteUseCase } from '../../../../src/modules/case-management/application/AddCaseNote.js';
import { createListCaseNotesUseCase } from '../../../../src/modules/case-management/application/ListCaseNotes.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateCaseNoteId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseNoteId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryCaseNoteRepository } from '../../../helpers/case-management/InMemoryCaseNoteRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});

function buildCase(organizationId = ORG_1): Case {
  return Case.create({
    id: createCaseId(oid('case-1')),
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    // La regla de asignacion congela los expedientes huerfanos:
    // sin responsable no se pueden trabajar.
    assignedTo: createAssignedTo('USER', oid('analyst-1')),
    now: NOW,
  });
}

function build() {
  const cases = new InMemoryCaseRepository();
  const notes = new InMemoryCaseNoteRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const addCaseNote = createAddCaseNoteUseCase({
    cases,
    notes,
    timelineRecorder,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateCaseNoteId,
    generateTimelineEventId,
  });
  const listCaseNotes = createListCaseNotesUseCase({ cases, notes });
  return { cases, notes, timelineRecorder, auditRecorder, addCaseNote, listCaseNotes };
}

describe('createAddCaseNoteUseCase', () => {
  it('persists the note + a NOTE_ADDED timeline event + an ADD_CASE_NOTE audit row atomically', async () => {
    const { cases, notes, timelineRecorder, auditRecorder, addCaseNote } = build();
    await cases.save(buildCase());

    const note = await addCaseNote({ auth: ANALYST, caseId: oid('case-1'), body: 'looks fraudulent' });

    expect((await notes.listByCaseId(createCaseId(oid('case-1')))).map((n) => n.body)).toEqual([
      'looks fraudulent',
    ]);
    const timeline = timelineRecorder.all();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.eventType).toBe('NOTE_ADDED');
    expect(timeline[0]?.newValue).toBe(note.id);
    const audits = auditRecorder.all();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('ADD_CASE_NOTE');
  });

  it('throws caseNotFound when the case does not exist', async () => {
    const { addCaseNote } = build();
    await expect(
      addCaseNote({ auth: ANALYST, caseId: oid('missing'), body: 'x' }),
    ).rejects.toBeInstanceOf(CaseManagementError);
  });

  it('throws forbiddenCrossTenant for a case in another organization', async () => {
    const { cases, addCaseNote } = build();
    await cases.save(buildCase(ORG_2));
    await expect(
      addCaseNote({ auth: ANALYST, caseId: oid('case-1'), body: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  it('lists notes oldest-first for the owning tenant', async () => {
    const { cases, addCaseNote, listCaseNotes } = build();
    await cases.save(buildCase());
    await addCaseNote({ auth: ANALYST, caseId: oid('case-1'), body: 'first' });
    await addCaseNote({ auth: ANALYST, caseId: oid('case-1'), body: 'second' });

    const listed = await listCaseNotes({ auth: ANALYST, caseId: oid('case-1') });
    expect(listed.map((n) => n.body)).toEqual(['first', 'second']);
  });
});

/*
 * El informe congelado se genera al cerrar el expediente. Permitir que
 * despues se le anadan notas o evidencia produce la peor combinacion posible:
 * un expediente cuyo contenido real ya no coincide con el documento que se
 * entrego como su foto inmutable.
 */
describe('un expediente cerrado no se instruye', () => {
  it('rechaza anadir una nota a un caso resuelto', async () => {
    const { addCaseNote, cases } = build();
    const resuelto = Case.rehydrate({
      ...toProps(buildCase()),
      status: 'RESOLVED',
    });
    await cases.save(resuelto);

    await expect(
      addCaseNote({ auth: ANALYST, caseId: oid('case-1'), body: 'tarde' }),
    ).rejects.toThrow(/reopen it before working on it again/);
  });
});

function toProps(kase: Case) {
  return {
    id: kase.id,
    organizationId: kase.organizationId,
    customerId: kase.customerId,
    customerEmail: kase.customerEmail,
    bridgeUserId: kase.bridgeUserId,
    bridgeWallet: kase.bridgeWallet,
    stripeCustomerId: kase.stripeCustomerId,
    finturuReference: kase.finturuReference,
    finturuCacheSnapshot: kase.finturuCacheSnapshot,
    riskScore: kase.riskScore,
    status: kase.status,
    priority: kase.priority,
    assignedTo: kase.assignedTo,
    dueDate: kase.dueDate,
    tags: kase.tags,
    createdAt: kase.createdAt,
    updatedAt: kase.updatedAt,
    deletedAt: kase.deletedAt,
  };
}

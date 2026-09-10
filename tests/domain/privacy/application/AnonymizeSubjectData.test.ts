import { oid } from '../../../support/oid.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { PrivacyDataRequest } from '../../../../src/modules/privacy/domain/model/aggregates/PrivacyDataRequest.js';
import { createPrivacyDataRequestId } from '../../../../src/modules/privacy/domain/model/value-objects/PrivacyDataRequestId.js';
import { createAnonymizeSubjectDataUseCase } from '../../../../src/modules/privacy/application/AnonymizeSubjectData.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/privacy/infrastructure/PassthroughUnitOfWork.js';
import { InMemoryPrivacyDataRequestRepository } from '../../../helpers/privacy/InMemoryPrivacyDataRequestRepository.js';
import { InMemoryPrivacyAuditRecorder } from '../../../helpers/privacy/InMemoryPrivacyAuditRecorder.js';
import { FakeSubjectDataSource } from '../../../helpers/privacy/FakeSubjectDataSource.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import type { SubjectRecord } from '../../../../src/modules/privacy/domain/ports/SubjectDataSource.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const REQ_ID = createPrivacyDataRequestId(oid('req-1'));

const SUPERVISOR = createAuthContext({
  userId: oid('sup-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});
const ANALYST = createAuthContext({
  userId: oid('an-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});

function record(id: string, retainedUntil: string | null): SubjectRecord {
  return {
    kind: 'case',
    id,
    openedAt: fromDate(new Date('2020-01-01T00:00:00.000Z')),
    closedAt: null,
    retainedUntil: retainedUntil === null ? null : fromDate(new Date(retainedUntil)),
    retentionBasis: retainedUntil === null ? null : 'Retención antilavado (5 años)',
    personalData: { customerEmail: 'ana@correo.com' },
    retainedData: { riskScore: 88 },
  };
}

function build(organizationId = ORG_1) {
  const requests = new InMemoryPrivacyDataRequestRepository();
  const subjectData = new FakeSubjectDataSource();
  const auditRecorder = new InMemoryPrivacyAuditRecorder();

  requests.seed(
    PrivacyDataRequest.create({
      id: REQ_ID,
      organizationId,
      subjectEmail: 'ana@correo.com',
      type: 'ERASURE',
      createdBy: oid('sup-1'),
      now: NOW,
    }),
  );

  const anonymizeSubjectData = createAnonymizeSubjectDataUseCase({
    requests,
    subjectData,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
  });

  return { anonymizeSubjectData, requests, subjectData, auditRecorder };
}

describe('createAnonymizeSubjectDataUseCase', () => {
  it('enmascara lo que puede y deja intacto lo retenido por ley', async () => {
    const { anonymizeSubjectData, subjectData, auditRecorder } = build();
    subjectData.seed(record('caso-libre', null));
    subjectData.seed(record('caso-retenido', '2031-01-01T00:00:00.000Z'));

    const result = await anonymizeSubjectData({ auth: SUPERVISOR, requestId: REQ_ID });

    expect(subjectData.masked()).toEqual(['caso-libre']);
    expect(result.maskedCount).toBe(1);
    expect(result.barred.map((b) => b.id)).toEqual(['caso-retenido']);
    // Es PARCIAL, no CUMPLIDA: queda un registro que sigue nombrando a la persona.
    expect(result.suggestedResolution).toBe('PARTIALLY_FULFILLED');
  });

  it('audita lo que NO se borró, no solo lo que se borró', async () => {
    const { anonymizeSubjectData, subjectData, auditRecorder } = build();
    subjectData.seed(record('caso-libre', null));
    subjectData.seed(record('caso-retenido', '2031-01-01T00:00:00.000Z'));

    await anonymizeSubjectData({ auth: SUPERVISOR, requestId: REQ_ID });

    const [event] = auditRecorder.all();
    expect(event!.action).toBe('ANONYMIZE_SUBJECT_DATA');
    // La mitad retenida es la que hay que justificar ante una reclamación.
    expect(event!.detail.barredIds).toEqual(['caso-retenido']);
    expect(event!.detail.barredUntil).toBe(fromDate(new Date('2031-01-01T00:00:00.000Z')));
    expect(event!.detail.retentionBases).toEqual(['Retención antilavado (5 años)']);
  });

  it('si TODO está retenido, rechaza diciendo la base legal y hasta cuándo', async () => {
    const { anonymizeSubjectData, subjectData } = build();
    subjectData.seed(record('a', '2031-01-01T00:00:00.000Z'));
    subjectData.seed(record('b', '2029-01-01T00:00:00.000Z'));

    await expect(anonymizeSubjectData({ auth: SUPERVISOR, requestId: REQ_ID })).rejects.toMatchObject({
      code: 'ERASURE_BARRED_BY_RETENTION',
      metadata: {
        basis: 'Retención antilavado (5 años)',
        retainedUntil: fromDate(new Date('2031-01-01T00:00:00.000Z')),
      },
    });
  });

  it('no tener registros NO es un rechazo: se resuelve como cumplida', async () => {
    // Distinto del caso anterior a propósito: "no hay nada tuyo" se satisface
    // trivialmente; "no puedo borrarlo" es una negativa que hay que motivar.
    const { anonymizeSubjectData, subjectData } = build();

    const result = await anonymizeSubjectData({ auth: SUPERVISOR, requestId: REQ_ID });

    expect(result.maskedCount).toBe(0);
    expect(result.suggestedResolution).toBe('FULFILLED');
    expect(subjectData.masked()).toEqual([]);
  });

  it('un ANALYST no puede anonimizar', async () => {
    const { anonymizeSubjectData, subjectData } = build();
    subjectData.seed(record('caso-libre', null));

    await expect(anonymizeSubjectData({ auth: ANALYST, requestId: REQ_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
    expect(subjectData.masked()).toEqual([]);
  });

  it('una solicitud de otro tenant no existe', async () => {
    const { anonymizeSubjectData } = build(ORG_2);

    await expect(anonymizeSubjectData({ auth: SUPERVISOR, requestId: REQ_ID })).rejects.toMatchObject({
      code: 'PRIVACY_REQUEST_NOT_FOUND',
    });
  });

  it('deja la solicitud EN CURSO, no resuelta: resolver es un acto aparte', async () => {
    const { anonymizeSubjectData, requests, subjectData } = build();
    subjectData.seed(record('caso-libre', null));

    await anonymizeSubjectData({ auth: SUPERVISOR, requestId: REQ_ID });

    expect(requests.all()[0]!.status).toBe('IN_PROGRESS');
    expect(requests.all()[0]!.resolution).toBeNull();
  });
});

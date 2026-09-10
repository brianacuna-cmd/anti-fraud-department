import { oid } from '../../../support/oid.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { PrivacyDataRequest } from '../../../../src/modules/privacy/domain/model/aggregates/PrivacyDataRequest.js';
import { createPrivacyDataRequestId } from '../../../../src/modules/privacy/domain/model/value-objects/PrivacyDataRequestId.js';
import { createResolvePrivacyRequestUseCase } from '../../../../src/modules/privacy/application/ResolvePrivacyRequest.js';
import { Sha256CertificateIssuer } from '../../../../src/modules/privacy/infrastructure/adapters/outbound/crypto/Sha256CertificateIssuer.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/privacy/infrastructure/PassthroughUnitOfWork.js';
import { InMemoryPrivacyDataRequestRepository } from '../../../helpers/privacy/InMemoryPrivacyDataRequestRepository.js';
import { InMemoryPrivacyAuditRecorder } from '../../../helpers/privacy/InMemoryPrivacyAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';

const RECEIVED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const REQ_ID = createPrivacyDataRequestId(oid('req-1'));

const SUPERVISOR = createAuthContext({
  userId: oid('sup-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});

function build(now: string) {
  const requests = new InMemoryPrivacyDataRequestRepository();
  const auditRecorder = new InMemoryPrivacyAuditRecorder();

  requests.seed(
    PrivacyDataRequest.create({
      id: REQ_ID,
      organizationId: ORG_1,
      subjectEmail: 'ana@correo.com',
      type: 'ERASURE',
      createdBy: oid('sup-1'),
      now: RECEIVED_AT,
    }),
  );

  const resolvePrivacyRequest = createResolvePrivacyRequestUseCase({
    requests,
    certificates: new Sha256CertificateIssuer(),
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(fromDate(new Date(now))),
  });

  return { resolvePrivacyRequest, requests, auditRecorder };
}

describe('createResolvePrivacyRequestUseCase', () => {
  it('devuelve la constancia entera pero solo persiste su huella', async () => {
    const { resolvePrivacyRequest, requests } = build('2026-01-05T00:00:00.000Z');

    const { request, certificate } = await resolvePrivacyRequest({
      auth: SUPERVISOR,
      requestId: REQ_ID,
      resolution: 'PARTIALLY_FULFILLED',
      note: 'Se anonimizó el expediente cerrado; el resto sigue en retención antilavado.',
    });

    expect(certificate).toContain('CONSTANCIA');
    expect(certificate).toContain('ana@correo.com');
    // La huella queda; el documento no. Guardarlo entero crearía una tercera
    // copia de los datos del titular en la tabla que existe para tener menos.
    expect(request.certificateHash).toHaveLength(64);
    expect(JSON.stringify(requests.all()[0])).not.toContain('CONSTANCIA');
  });

  it('la huella corresponde a ESE documento', async () => {
    const { resolvePrivacyRequest } = build('2026-01-05T00:00:00.000Z');
    const issuer = new Sha256CertificateIssuer();

    const { request, certificate } = await resolvePrivacyRequest({
      auth: SUPERVISOR,
      requestId: REQ_ID,
      resolution: 'FULFILLED',
      note: 'Atendida en su totalidad.',
    });

    const recomputada = issuer.issue({
      requestId: request.id,
      subjectEmail: request.subjectEmail,
      type: request.type,
      resolution: 'FULFILLED',
      note: 'Atendida en su totalidad.',
      resolvedAtIso: request.resolvedAt!,
    });

    expect(recomputada.sha256).toBe(request.certificateHash);
    expect(recomputada.document).toBe(certificate);
  });

  it('registra si se cumplió el plazo legal, decidido en el momento de resolver', async () => {
    const dentro = build('2026-01-20T00:00:00.000Z');
    await dentro.resolvePrivacyRequest({
      auth: SUPERVISOR,
      requestId: REQ_ID,
      resolution: 'FULFILLED',
      note: 'A tiempo.',
    });
    expect(dentro.auditRecorder.all()[0]!.detail.withinDeadline).toBe(true);

    const fuera = build('2026-03-01T00:00:00.000Z');
    await fuera.resolvePrivacyRequest({
      auth: SUPERVISOR,
      requestId: REQ_ID,
      resolution: 'FULFILLED',
      note: 'Tarde.',
    });
    // Se congela aquí a propósito: recalcularlo después contra una regla
    // distinta reescribiría la historia.
    expect(fuera.auditRecorder.all()[0]!.detail.withinDeadline).toBe(false);
  });

  it('no se resuelve dos veces', async () => {
    const { resolvePrivacyRequest } = build('2026-01-05T00:00:00.000Z');
    await resolvePrivacyRequest({
      auth: SUPERVISOR,
      requestId: REQ_ID,
      resolution: 'FULFILLED',
      note: 'Atendida.',
    });

    await expect(
      resolvePrivacyRequest({
        auth: SUPERVISOR,
        requestId: REQ_ID,
        resolution: 'REJECTED',
        note: 'Otra vez.',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

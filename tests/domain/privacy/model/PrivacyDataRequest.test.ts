import { oid } from '../../../support/oid.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import {
  PrivacyDataRequest,
  RESPONSE_DEADLINE_DAYS,
} from '../../../../src/modules/privacy/domain/model/aggregates/PrivacyDataRequest.js';
import { createPrivacyDataRequestId } from '../../../../src/modules/privacy/domain/model/value-objects/PrivacyDataRequestId.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-10T00:00:00.000Z'));
const ID = createPrivacyDataRequestId(oid('req-1'));

function create(overrides: Partial<Parameters<typeof PrivacyDataRequest.create>[0]> = {}) {
  return PrivacyDataRequest.create({
    id: ID,
    organizationId: oid('org-1'),
    subjectEmail: 'Ana@Correo.com',
    type: 'ERASURE',
    createdBy: oid('sup-1'),
    now: NOW,
    ...overrides,
  });
}

describe('PrivacyDataRequest', () => {
  it('nace RECIBIDA, con el correo normalizado y el plazo ya fijado', () => {
    const request = create();

    expect(request.status).toBe('RECEIVED');
    // En minúsculas: el mismo titular escribiendo con otra capitalización es
    // el mismo titular, y la búsqueda de sus registros va por este campo.
    expect(request.subjectEmail).toBe('ana@correo.com');
    expect(request.dueAt).toBe(fromDate(new Date('2026-01-31T00:00:00.000Z')));
    expect(RESPONSE_DEADLINE_DAYS).toBe(30);
  });

  it('rechaza un correo que no lo parece', () => {
    expect(() => create({ subjectEmail: 'no es un correo' })).toThrow(/subjectEmail/);
    expect(() => create({ subjectEmail: '   ' })).toThrow(/subjectEmail/);
  });

  it('acepta direcciones raras pero legales', () => {
    // Un `+` o un punto no pueden ser motivo para no tramitar una solicitud.
    expect(create({ subjectEmail: 'ana+fraude@correo.com' }).subjectEmail).toBe(
      'ana+fraude@correo.com',
    );
  });

  it('start es idempotente y no muta el original', () => {
    const request = create();
    const started = request.start(LATER);

    expect(started.status).toBe('IN_PROGRESS');
    expect(request.status).toBe('RECEIVED');
    // Trabajar dos veces sobre la misma solicitud es normal: exportar y luego
    // anonimizar. La segunda pasada no debería tener que mirar el estado.
    expect(started.start(LATER)).toBe(started);
  });

  it('no se resuelve sin motivación', () => {
    const request = create();

    expect(() =>
      request.resolve({
        resolution: 'FULFILLED',
        note: '   ',
        certificateHash: 'abc',
        resolvedBy: oid('sup-1'),
        now: LATER,
      }),
    ).toThrow(/sin estatuir|stating why/i);
  });

  it('resolver como RECHAZADA deja la solicitud en REJECTED, no en COMPLETED', () => {
    const resolved = create().resolve({
      resolution: 'REJECTED',
      note: 'Retención antilavado vigente hasta 2031.',
      certificateHash: 'abc',
      resolvedBy: oid('sup-1'),
      now: LATER,
    });

    expect(resolved.status).toBe('REJECTED');
    expect(resolved.resolution).toBe('REJECTED');
  });

  it('una solicitud ya resuelta no se vuelve a resolver', () => {
    const resolved = create().resolve({
      resolution: 'FULFILLED',
      note: 'Se borró todo.',
      certificateHash: 'abc',
      resolvedBy: oid('sup-1'),
      now: LATER,
    });

    expect(() =>
      resolved.resolve({
        resolution: 'REJECTED',
        note: 'Cambio de opinión.',
        certificateHash: 'def',
        resolvedBy: oid('sup-2'),
        now: LATER,
      }),
    ).toThrow(/INVALID_TRANSITION|cannot go from/);
  });

  it('isOverdue mira el plazo, y deja de aplicar una vez resuelta', () => {
    const request = create();
    const antes = fromDate(new Date('2026-01-30T00:00:00.000Z'));
    const despues = fromDate(new Date('2026-02-01T00:00:00.000Z'));

    expect(request.isOverdue(antes)).toBe(false);
    expect(request.isOverdue(despues)).toBe(true);

    const resolved = request.resolve({
      resolution: 'FULFILLED',
      note: 'Atendida.',
      certificateHash: 'abc',
      resolvedBy: oid('sup-1'),
      now: despues,
    });
    // Fuera de plazo se resolvió, pero ya no está "venciendo": el retraso queda
    // en la auditoría, no como una alarma perpetua en la bandeja.
    expect(resolved.isOverdue(despues)).toBe(false);
  });
});

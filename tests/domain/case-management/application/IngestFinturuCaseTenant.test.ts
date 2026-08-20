import { createIngestFinturuCaseUseCase } from '../../../../src/modules/case-management/application/IngestFinturuCase.js';
import { createInitializeCaseSlaService } from '../../../../src/modules/case-management/application/InitializeCaseSla.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { generateCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { oid } from '../../../support/oid.js';

const NOW = fromDate(new Date('2026-08-20T10:00:00.000Z'));
const ORG = oid('org-finturu');

function build() {
  const cases = new InMemoryCaseRepository();
  const outbox = new InMemoryOutboxEventRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();

  const ingestFinturuCase = createIngestFinturuCaseUseCase({
    cases,
    timelineRecorder: new InMemoryTimelineRecorder(),
    outbox,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateCaseId,
    generateTimelineEventId,
    generateOutboxEventId,
    auditRecorder: new InMemoryCaseManagementAuditRecorder(),
    initializeCaseSla: createInitializeCaseSlaService({
      slaTracking,
      fraudConfig: new InMemoryOrganizationFraudConfigRepository(),
      generateCaseSlaTrackingId,
    }),
  });

  return { ingestFinturuCase, cases, outbox };
}

/**
 * Regresion: el inquilino se resolvia a un literal `'finturu-org'` cuando no
 * llegaba ninguno. Desde la migracion a ObjectId nativo eso reventaba dentro
 * del driver de Mongo con un `BSONError` sobre cadenas hexadecimales — un 400
 * cuyo mensaje no mencionaba la organizacion por ningun lado.
 */
describe('IngestFinturuCase — resolución del inquilino', () => {
  it('rechaza el payload cuando no hay organización ni por defecto, nombrando el campo que falta', async () => {
    const { ingestFinturuCase, cases } = build();

    await expect(ingestFinturuCase({ rawPayload: { idUser: 'usr_1' } })).rejects.toThrow(CaseManagementError);
    await expect(ingestFinturuCase({ rawPayload: { idUser: 'usr_1' } })).rejects.toThrow(/resolved no organization/);

    // Y nada quedó a medias.
    expect(cases.all()).toHaveLength(0);
  });

  it('rechaza un slug en vez de archivarlo bajo el inquilino por defecto', async () => {
    const { ingestFinturuCase, cases } = build();

    // El payload designa un inquilino concreto que no sabemos resolver. Caer al
    // de por defecto colocaria el expediente de fraude de un cliente ajeno en
    // otra organizacion, que es una fuga entre inquilinos.
    await expect(
      ingestFinturuCase({
        rawPayload: { idUser: 'usr_1', organizationSlug: 'acme-corp' },
        defaultOrganizationId: ORG,
      }),
    ).rejects.toThrow(/"acme-corp".*ObjectId/);

    expect(cases.all()).toHaveLength(0);
  });

  it('acepta la organización por defecto cuando el payload no trae ninguna', async () => {
    const { ingestFinturuCase, cases } = build();

    const result = await ingestFinturuCase({
      rawPayload: { idUser: 'usr_1' },
      defaultOrganizationId: ORG,
    });

    expect(result.case.organizationId).toBe(ORG);
    expect(cases.all()).toHaveLength(1);
  });

  it('la organización del payload gana sobre la de por defecto', async () => {
    const { ingestFinturuCase } = build();
    const payloadOrg = oid('org-del-payload');

    const result = await ingestFinturuCase({
      rawPayload: { idUser: 'usr_1', organization_id: payloadOrg },
      defaultOrganizationId: ORG,
    });

    expect(result.case.organizationId).toBe(payloadOrg);
  });
});

import { oid } from '../../../support/oid.js';
import { createIngestFinturuCaseUseCase } from '../../../../src/modules/case-management/application/IngestFinturuCase.js';
import { createInitializeCaseSlaService } from '../../../../src/modules/case-management/application/InitializeCaseSla.js';
import { createEnqueueCustomerWebhookFanOut } from '../../../../src/modules/case-management/application/EnqueueCustomerWebhookFanOut.js';
import { CustomerWebhookSubscription } from '../../../../src/modules/case-management/domain/model/aggregates/CustomerWebhookSubscription.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { generateCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { generateCustomerWebhookSubscriptionId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { generateCustomerOutgoingEventId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryCustomerWebhookSubscriptionRepository } from '../../../helpers/case-management/InMemoryCustomerWebhookSubscriptionRepository.js';
import { InMemoryCustomerOutgoingEventRepository } from '../../../helpers/case-management/InMemoryCustomerOutgoingEventRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');

function build() {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const outbox = new InMemoryOutboxEventRepository();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
  const outgoingEvents = new InMemoryCustomerOutgoingEventRepository();
  fraudConfig.seed(
    OrganizationFraudConfig.create({
      id: generateOrganizationFraudConfigId(),
      organizationId: ORG,
      slaLowMinutes: 240,
      slaMediumMinutes: 120,
      slaHighMinutes: 60,
      slaCriticalMinutes: 30,
      riskThresholdLow: 25,
      riskThresholdMedium: 50,
      riskThresholdHigh: 75,
      riskThresholdCritical: 90,
      now: NOW,
    }),
  );
  const ingest = createIngestFinturuCaseUseCase({
    cases,
    timelineRecorder,
    outbox,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateCaseId,
    generateTimelineEventId,
    generateOutboxEventId,
    auditRecorder,
    initializeCaseSla: createInitializeCaseSlaService({
      slaTracking: new InMemoryCaseSlaTrackingRepository(),
      fraudConfig,
      generateCaseSlaTrackingId,
    }),
    enqueueCustomerWebhookFanOut: createEnqueueCustomerWebhookFanOut({
      subscriptions,
      outgoingEvents,
      generateCustomerOutgoingEventId,
    }),
  });
  return { ingest, outbox, outgoingEvents, subscriptions };
}

describe('IngestFinturuCase ticket webhook fan-out', () => {
  it('writes PENDING case.created rows for ACTIVE subscriptions after Kafka outbox', async () => {
    const { ingest, outbox, outgoingEvents, subscriptions } = build();
    await subscriptions.create(
      CustomerWebhookSubscription.create({
        id: generateCustomerWebhookSubscriptionId(),
        organizationId: ORG,
        url: 'https://hooks.example/ingest',
        eventTypes: ['case.created'],
        now: NOW,
      }),
    );

    const result = await ingest({
      rawPayload: {
        organization_id: ORG,
        customerId: oid('customer-1'),
        riskScore: 40,
      },
    });

    expect(outbox.all()).toHaveLength(1);
    expect(outbox.all()[0]!.eventType).toBe('case.created');
    expect(outgoingEvents.all()).toHaveLength(1);
    expect(outgoingEvents.all()[0]!.eventType).toBe('case.created');
    expect(outgoingEvents.all()[0]!.enforcementActionId).toBeNull();
    expect(outgoingEvents.all()[0]!.payload).toMatchObject({
      event_type: 'case.created',
      caseId: result.case.id,
    });
  });

  it('does not fan-out on snapshot refresh of an active case', async () => {
    const { ingest, outgoingEvents, subscriptions } = build();
    await subscriptions.create(
      CustomerWebhookSubscription.create({
        id: generateCustomerWebhookSubscriptionId(),
        organizationId: ORG,
        url: 'https://hooks.example/ingest',
        eventTypes: ['case.created'],
        now: NOW,
      }),
    );
    await ingest({
      rawPayload: { organization_id: ORG, customerId: oid('customer-1'), riskScore: 40 },
    });
    expect(outgoingEvents.all()).toHaveLength(1);

    await ingest({
      rawPayload: { organization_id: ORG, customerId: oid('customer-1'), riskScore: 55 },
    });
    expect(outgoingEvents.all()).toHaveLength(1);
  });
});

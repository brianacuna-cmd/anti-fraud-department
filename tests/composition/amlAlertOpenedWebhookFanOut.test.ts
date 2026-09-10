import { oid } from '../support/oid.js';
import { createAmlAlertOpenedWebhookFanOut } from '../../src/composition/amlAlertOpenedWebhookFanOut.js';
import { createEnqueueCustomerWebhookFanOut } from '../../src/modules/case-management/application/EnqueueCustomerWebhookFanOut.js';
import { CustomerWebhookSubscription } from '../../src/modules/case-management/domain/model/aggregates/CustomerWebhookSubscription.js';
import { generateCustomerWebhookSubscriptionId } from '../../src/modules/case-management/domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { generateCustomerOutgoingEventId } from '../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { InMemoryCustomerWebhookSubscriptionRepository } from '../helpers/case-management/InMemoryCustomerWebhookSubscriptionRepository.js';
import { InMemoryCustomerOutgoingEventRepository } from '../helpers/case-management/InMemoryCustomerOutgoingEventRepository.js';
import { AmlAlert } from '../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { generateAmlAlertId } from '../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import type { Transaction as ScreeningTransaction } from '../../src/modules/screening/domain/ports/UnitOfWork.js';
import { FixedClock } from '../helpers/FixedClock.js';
import { fromDate } from '../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');

describe('createAmlAlertOpenedWebhookFanOut', () => {
  it('enqueues PENDING aml.alert_generated without starting a second transaction', async () => {
    const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
    const outgoingEvents = new InMemoryCustomerOutgoingEventRepository();
    await subscriptions.create(
      CustomerWebhookSubscription.create({
        id: generateCustomerWebhookSubscriptionId(),
        organizationId: ORG,
        url: 'https://hooks.example/aml',
        eventTypes: ['aml.alert_generated'],
        now: NOW,
      }),
    );
    const enqueue = createEnqueueCustomerWebhookFanOut({
      subscriptions,
      outgoingEvents,
      generateCustomerOutgoingEventId,
    });
    const onOpened = createAmlAlertOpenedWebhookFanOut(enqueue, new FixedClock(NOW));
    const alert = AmlAlert.create({
      id: generateAmlAlertId(),
      organizationId: ORG,
      customerId: oid('customer-1'),
      suspectedEntity: 'John Smith',
      confidence: createMatchScore(82),
      detectionSource: oid('watchlist-1'),
      severity: 'HIGH',
      matchedEntry: createScreeningMatch({
        entryId: createWatchlistEntryId(oid('entry-1')),
        watchlistId: createWatchlistId(oid('watchlist-1')),
        name: 'John Smith',
        document: '123',
        riskLevel: 'HIGH',
        matchField: 'NAME',
        algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
      }),
      now: NOW,
    });

    await onOpened({ alert, organizationId: ORG, tx: {} as ScreeningTransaction });

    expect(outgoingEvents.all()).toHaveLength(1);
    expect(outgoingEvents.all()[0]!.eventType).toBe('aml.alert_generated');
    expect(outgoingEvents.all()[0]!.payload).toMatchObject({
      event_type: 'aml.alert_generated',
      alert_id: String(alert.id),
      customer_id: oid('customer-1'),
    });
  });
});

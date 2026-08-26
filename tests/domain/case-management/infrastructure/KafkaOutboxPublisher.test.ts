import { createKafkaOutboxPublisher, outboxEventMessage } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/kafka/KafkaOutboxPublisher.js';
import { OutboxEvent } from '../../../../src/shared/outbox/OutboxEvent.js';
import { createOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { oid } from '../../../support/oid.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-08-26T15:00:00.000Z'));

function event() {
  return OutboxEvent.create({
    id: createOutboxEventId(oid('outbox-1')),
    organizationId: oid('org-1'),
    aggregateType: 'aml_alerts',
    aggregateId: oid('alert-1'),
    eventType: 'AML_ALERT_CREATED',
    payload: { alert_id: oid('alert-1') },
    now: NOW,
  });
}

describe('createKafkaOutboxPublisher', () => {
  it('sends one record keyed by event id on the configured topic', async () => {
    const send = jest.fn(async () => [{ topicName: 'outbox.events', partition: 0, errorCode: 0 }]);
    const publisher = await createKafkaOutboxPublisher({
      brokers: ['localhost:9092'],
      topic: 'outbox.events',
      producer: { connect: jest.fn(async () => undefined), send },
    });
    const e = event();

    await publisher.publish(e);

    const expected = outboxEventMessage(e);
    expect(send).toHaveBeenCalledWith({
      topic: 'outbox.events',
      messages: [{ key: expected.key, value: expected.value, headers: expected.headers }],
    });
    expect(expected.key).toBe(String(e.id));
    expect(JSON.parse(expected.value)).toMatchObject({
      eventType: 'AML_ALERT_CREATED',
      aggregateType: 'aml_alerts',
    });
  });

  it('propagates producer failures so the relay can mark FAILED', async () => {
    const publisher = await createKafkaOutboxPublisher({
      brokers: ['localhost:9092'],
      topic: 'outbox.events',
      producer: {
        connect: jest.fn(async () => undefined),
        send: jest.fn(async () => {
          throw new Error('broker unavailable');
        }),
      },
    });

    await expect(publisher.publish(event())).rejects.toThrow('broker unavailable');
  });
});

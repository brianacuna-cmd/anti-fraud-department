import { Kafka, type Producer } from 'kafkajs';
import type { OutboxPublisher } from '../../../../application/PublishOutboxEvents.js';
import type { OutboxEvent } from '../../../../../../shared/outbox/OutboxEvent.js';

export interface KafkaOutboxPublisherConfig {
  readonly brokers: readonly string[];
  readonly topic: string;
  readonly clientId?: string;
  /** Injectable producer for unit tests. When omitted, a real Kafka producer is connected. */
  readonly producer?: Pick<Producer, 'send' | 'connect'>;
}

export function outboxEventMessage(event: OutboxEvent): {
  readonly key: string;
  readonly value: string;
  readonly headers: Record<string, string>;
} {
  return {
    key: String(event.id),
    value: JSON.stringify({
      id: String(event.id),
      organizationId: event.organizationId,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
    }),
    headers: {
      event_type: event.eventType,
      organization_id: event.organizationId,
    },
  };
}

/**
 * `OutboxPublisher` that produces one Kafka record per outbox row.
 * Delivery remains at-least-once: the relay marks PUBLISHED only after `send` resolves.
 */
export async function createKafkaOutboxPublisher(config: KafkaOutboxPublisherConfig): Promise<OutboxPublisher> {
  const producer =
    config.producer ??
    new Kafka({
      clientId: config.clientId ?? 'anti-fraud-department',
      brokers: [...config.brokers],
    }).producer();
  await producer.connect();

  return {
    async publish(event: OutboxEvent): Promise<void> {
      const message = outboxEventMessage(event);
      await producer.send({
        topic: config.topic,
        messages: [{ key: message.key, value: message.value, headers: message.headers }],
      });
    },
  };
}

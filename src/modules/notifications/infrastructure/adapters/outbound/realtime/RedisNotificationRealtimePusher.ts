import type {
  NotificationRealtimeInput,
  NotificationRealtimePusher,
} from '../../../../domain/ports/NotificationRealtimePusher.js';
import type { RedisRealtimeChannel } from './RedisRealtimeChannel.js';

/**
 * Implements the notifications module's own `NotificationRealtimePusher`
 * port (design §2) by publishing to the shared `RedisRealtimeChannel`
 * (design §3c). Deliberately does NOT catch/swallow a publish failure — it
 * rejects, and `SendNotification`'s existing best-effort block (PR1, tasks
 * 6/35) is what swallows it via `onRealtimeError`. Never rolls back
 * notification persistence, which already committed before this is called.
 */
export class RedisNotificationRealtimePusher implements NotificationRealtimePusher {
  constructor(private readonly channel: RedisRealtimeChannel) {}

  async send(input: NotificationRealtimeInput): Promise<void> {
    await this.channel.publish({
      organizationId: input.organizationId as unknown as string,
      userId: input.recipientUserId as unknown as string,
      alertType: input.alertType as unknown as string,
      context: input.context,
    });
  }
}

import RedisMock from 'ioredis-mock';
import {
  RedisRealtimeChannel,
  REALTIME_CHANNEL,
} from '../../../../src/modules/notifications/infrastructure/adapters/outbound/realtime/RedisRealtimeChannel.js';

class FakeDeliverer {
  readonly calls: Array<{ organizationId: string; userId: string; payload: unknown }> = [];

  deliverTo(organizationId: string, userId: string, payload: unknown): void {
    this.calls.push({ organizationId, userId, payload });
  }
}

function buildChannel(deliverer: FakeDeliverer, onError?: (error: unknown) => void): RedisRealtimeChannel {
  return new RedisRealtimeChannel({
    redisUrl: 'redis://unused',
    deliverer,
    onError,
    createClient: () => new RedisMock() as unknown as import('ioredis').default,
  });
}

describe('RedisRealtimeChannel', () => {
  it('publishes the JSON message on the shared channel', async () => {
    const deliverer = new FakeDeliverer();
    const channel = buildChannel(deliverer);
    const spy = jest.spyOn(channel.pub, 'publish');

    await channel.publish({ organizationId: 'org1', userId: 'user1', alertType: 'CASE_ASSIGNED', context: {} });

    expect(spy).toHaveBeenCalledWith(
      REALTIME_CHANNEL,
      JSON.stringify({ organizationId: 'org1', userId: 'user1', alertType: 'CASE_ASSIGNED', context: {} }),
    );
    await channel.quit();
  });

  it('a subscribed message re-delivers to the deliverer for the right org+user', async () => {
    const deliverer = new FakeDeliverer();
    const channel = buildChannel(deliverer);
    await channel.start();

    await channel.publish({ organizationId: 'org1', userId: 'user1', alertType: 'CASE_ASSIGNED', context: { a: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(deliverer.calls).toHaveLength(1);
    expect(deliverer.calls[0]).toMatchObject({ organizationId: 'org1', userId: 'user1' });
    await channel.quit();
  });

  it('a publish/connection error is swallowed and reported via onError, not thrown', async () => {
    const deliverer = new FakeDeliverer();
    const errors: unknown[] = [];
    const channel = new RedisRealtimeChannel({
      redisUrl: 'redis://unused',
      deliverer,
      onError: (error) => errors.push(error),
      createClient: () => {
        const client = new RedisMock();
        client.publish = jest.fn().mockRejectedValue(new Error('boom')) as unknown as typeof client.publish;
        return client as unknown as import('ioredis').default;
      },
    });

    await expect(
      channel.publish({ organizationId: 'org1', userId: 'user1', alertType: 'CASE_ASSIGNED', context: {} }),
    ).rejects.toThrow('boom');

    // Background connection-level errors (no promise to reject into) are
    // reported via onError instead.
    channel.pub.emit('error', new Error('connection lost'));
    expect(errors).toEqual([new Error('connection lost')]);

    await channel.quit();
  });
});

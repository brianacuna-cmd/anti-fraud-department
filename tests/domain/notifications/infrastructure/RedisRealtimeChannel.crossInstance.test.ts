import RedisMock from 'ioredis-mock';
import { RedisRealtimeChannel } from '../../../../src/modules/notifications/infrastructure/adapters/outbound/realtime/RedisRealtimeChannel.js';

class FakeDeliverer {
  readonly calls: Array<{ organizationId: string; userId: string }> = [];

  deliverTo(organizationId: string, userId: string): void {
    this.calls.push({ organizationId, userId });
  }
}

/**
 * Two `ioredis-mock` client pairs sharing the single in-process mock store
 * (design ADR-7) simulate two gateway instances subscribed to the same
 * Redis. Covers spec Scenario 5.1 (cross-instance delivery) and 5.2
 * (single-instance publish+self-subscribe delivers exactly once).
 */
describe('RedisRealtimeChannel — multi-instance fan-out', () => {
  it('an event published on instance A reaches a matching socket registered only on instance B (5.1)', async () => {
    const delivererA = new FakeDeliverer();
    const delivererB = new FakeDeliverer();
    const instanceA = new RedisRealtimeChannel({
      redisUrl: 'redis://shared',
      deliverer: delivererA,
      createClient: () => new RedisMock() as unknown as import('ioredis').default,
    });
    const instanceB = new RedisRealtimeChannel({
      redisUrl: 'redis://shared',
      deliverer: delivererB,
      createClient: () => new RedisMock() as unknown as import('ioredis').default,
    });
    await instanceA.start();
    await instanceB.start();

    await instanceA.publish({ organizationId: 'org1', userId: 'user1', alertType: 'CASE_ASSIGNED', context: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Both instances' subscribers receive it (delivery decision is the
    // deliverer's registry lookup, not the channel's) — B's local socket
    // matches, A's registry (empty for that org/user) delivers nothing.
    expect(delivererB.calls).toHaveLength(1);
    expect(delivererB.calls[0]).toEqual({ organizationId: 'org1', userId: 'user1' });
    expect(delivererA.calls).toHaveLength(1);

    await instanceA.quit();
    await instanceB.quit();
  });

  it('single-instance publish+self-subscribe delivers exactly one message (5.2)', async () => {
    const deliverer = new FakeDeliverer();
    const instance = new RedisRealtimeChannel({
      redisUrl: 'redis://shared-2',
      deliverer,
      createClient: () => new RedisMock() as unknown as import('ioredis').default,
    });
    await instance.start();

    await instance.publish({ organizationId: 'org1', userId: 'user1', alertType: 'CRITICAL_RISK', context: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(deliverer.calls).toHaveLength(1);

    await instance.quit();
  });
});

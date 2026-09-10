import RedisMock from 'ioredis-mock';
import { WebSocket } from 'ws';
import { RedisRealtimeChannel } from '../../../../src/modules/notifications/infrastructure/adapters/outbound/realtime/RedisRealtimeChannel.js';
import { WebSocketGateway } from '../../../../src/modules/notifications/infrastructure/adapters/inbound/realtime/WebSocketGateway.js';
import { ConnectionRegistry } from '../../../../src/modules/notifications/infrastructure/adapters/inbound/realtime/ConnectionRegistry.js';

/**
 * Proves a subscribed pub/sub message re-delivers to LOCAL sockets through
 * the REAL `WebSocketGateway.deliverTo` (not a fake deliverer), so an event
 * published on one instance reaches a matching socket registered on this
 * instance's `WebSocketGateway`/`ConnectionRegistry`.
 */
describe('RedisRealtimeChannel + WebSocketGateway integration', () => {
  it('delivers an incoming message to WebSocketGateway.deliverTo, reaching the matching socket', async () => {
    const registry = new ConnectionRegistry<WebSocket>();
    const gateway = new WebSocketGateway({
      server: { on: jest.fn() } as unknown as import('node:http').Server,
      registry,
      authenticator: { authenticate: async () => null },
    });

    const fakeSocket = { readyState: WebSocket.OPEN, send: jest.fn() } as unknown as WebSocket;
    registry.add('org1', 'user1', fakeSocket);

    const channel = new RedisRealtimeChannel({
      redisUrl: 'redis://unused',
      deliverer: gateway,
      createClient: () => new RedisMock() as unknown as import('ioredis').default,
    });
    await channel.start();

    await channel.publish({ organizationId: 'org1', userId: 'user1', alertType: 'CASE_ASSIGNED', context: { a: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fakeSocket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fakeSocket.send as jest.Mock).mock.calls[0][0])).toMatchObject({
      organizationId: 'org1',
      userId: 'user1',
      alertType: 'CASE_ASSIGNED',
    });

    await channel.quit();
  });
});

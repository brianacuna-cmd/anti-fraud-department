import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { WebSocketGateway } from '../../../src/modules/notifications/infrastructure/adapters/inbound/realtime/WebSocketGateway.js';
import { ConnectionRegistry } from '../../../src/modules/notifications/infrastructure/adapters/inbound/realtime/ConnectionRegistry.js';
import type { AuthenticatedPrincipal, SessionAuthenticator } from '../../../src/modules/notifications/domain/ports/SessionAuthenticator.js';

jest.setTimeout(20_000);

function fakeAuthenticator(byToken: Record<string, AuthenticatedPrincipal | null>): SessionAuthenticator {
  return {
    authenticate: async (token: string) => (token in byToken ? byToken[token] : null),
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return (server.address() as AddressInfo).port;
}

function connect(port: number, protocol?: string): WebSocket {
  return protocol ? new WebSocket(`ws://127.0.0.1:${port}`, protocol) : new WebSocket(`ws://127.0.0.1:${port}`);
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function waitCloseOrUnexpectedResponse(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.once('close', () => resolve());
    ws.once('unexpected-response', () => {
      ws.terminate();
      resolve();
    });
    ws.once('error', () => resolve());
  });
}

describe('WebSocketGateway', () => {
  let server: Server;
  let registry: ConnectionRegistry<WebSocket>;
  let gateway: WebSocketGateway;
  const sockets: WebSocket[] = [];

  beforeEach(() => {
    server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
  });

  afterEach(async () => {
    for (const ws of sockets) {
      ws.terminate();
    }
    sockets.length = 0;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('accepts a valid token, echoes the subprotocol, and registers the socket', async () => {
    const authenticator = fakeAuthenticator({ 'valid-token': { organizationId: 'org1', userId: 'user1' } });
    registry = new ConnectionRegistry<WebSocket>();
    gateway = new WebSocketGateway({ server, registry, authenticator });
    gateway.attach();

    const port = await listen(server);
    const ws = connect(port, 'valid-token');
    sockets.push(ws);
    await waitOpen(ws);

    expect(ws.protocol).toBe('valid-token');
    // `registry.socketsFor` holds the SERVER-side socket instance, distinct
    // from the client-side `ws` handle under test — assert via count +
    // actual delivery rather than reference/structural equality.
    expect(registry.socketsFor('org1', 'user1')).toHaveLength(1);
  });

  it('rejects an upgrade with no token and registers nothing', async () => {
    const authenticator = fakeAuthenticator({});
    registry = new ConnectionRegistry<WebSocket>();
    gateway = new WebSocketGateway({ server, registry, authenticator });
    gateway.attach();

    const port = await listen(server);
    const ws = connect(port);
    sockets.push(ws);
    await waitCloseOrUnexpectedResponse(ws);

    expect(registry.socketsFor('org1', 'user1')).toEqual([]);
  });

  it('rejects an upgrade when authenticate() returns null (invalid/expired/revoked)', async () => {
    const authenticator = fakeAuthenticator({ 'bad-token': null });
    registry = new ConnectionRegistry<WebSocket>();
    gateway = new WebSocketGateway({ server, registry, authenticator });
    gateway.attach();

    const port = await listen(server);
    const ws = connect(port, 'bad-token');
    sockets.push(ws);
    await waitCloseOrUnexpectedResponse(ws);

    expect(registry.socketsFor('org1', 'user1')).toEqual([]);
  });

  it('delivers a payload only to the targeted principal (tenant isolation)', async () => {
    const authenticator = fakeAuthenticator({
      'token-a': { organizationId: 'org1', userId: 'user1' },
      'token-b': { organizationId: 'org1', userId: 'user2' },
    });
    registry = new ConnectionRegistry<WebSocket>();
    gateway = new WebSocketGateway({ server, registry, authenticator });
    gateway.attach();

    const port = await listen(server);
    const wsA = connect(port, 'token-a');
    const wsB = connect(port, 'token-b');
    sockets.push(wsA, wsB);
    await Promise.all([waitOpen(wsA), waitOpen(wsB)]);

    const receivedByA: string[] = [];
    const receivedByB: string[] = [];
    wsA.on('message', (data) => receivedByA.push(data.toString()));
    wsB.on('message', (data) => receivedByB.push(data.toString()));

    const delivered = new Promise<void>((resolve) => wsA.once('message', () => resolve()));
    gateway.deliverTo('org1', 'user1', { hello: 'world' });
    await delivered;

    expect(receivedByA).toEqual([JSON.stringify({ hello: 'world' })]);
    expect(receivedByB).toEqual([]);
  });

  it('deregisters the socket on close and no longer delivers to it', async () => {
    const authenticator = fakeAuthenticator({ 'token-c': { organizationId: 'org1', userId: 'user3' } });
    registry = new ConnectionRegistry<WebSocket>();
    gateway = new WebSocketGateway({ server, registry, authenticator });
    gateway.attach();

    const port = await listen(server);
    const ws = connect(port, 'token-c');
    sockets.push(ws);
    await waitOpen(ws);
    expect(registry.socketsFor('org1', 'user3')).toHaveLength(1);

    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    ws.close();
    await closed;
    await new Promise((resolve) => setImmediate(resolve));

    expect(registry.socketsFor('org1', 'user3')).toEqual([]);
    expect(() => gateway.deliverTo('org1', 'user3', { hello: 'world' })).not.toThrow();
  });
});

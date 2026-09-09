import {
  ConnectionRegistry,
  type RealtimeSocket,
} from '../../../../src/modules/notifications/infrastructure/adapters/inbound/realtime/ConnectionRegistry.js';

const createFakeSocket = (): RealtimeSocket => ({
  close: () => {},
});

describe('ConnectionRegistry', () => {
  it('returns the socket registered for an organization/user pair', () => {
    const registry = new ConnectionRegistry();
    const socket = createFakeSocket();

    registry.add('org1', 'user1', socket);

    expect([...registry.socketsFor('org1', 'user1')]).toEqual([socket]);
  });

  it('never leaks sockets across organizations or users (tenant isolation)', () => {
    const registry = new ConnectionRegistry();
    const socketOrg1User1 = createFakeSocket();

    registry.add('org1', 'user1', socketOrg1User1);

    expect([...registry.socketsFor('org2', 'user1')]).toEqual([]);
    expect([...registry.socketsFor('org1', 'user2')]).toEqual([]);
  });

  it('supports multiple sockets for the same principal (multi-tab)', () => {
    const registry = new ConnectionRegistry();
    const socketA = createFakeSocket();
    const socketB = createFakeSocket();

    registry.add('org1', 'user1', socketA);
    registry.add('org1', 'user1', socketB);

    expect([...registry.socketsFor('org1', 'user1')].sort()).toEqual(
      [socketA, socketB].sort(),
    );
  });

  it('removes a socket and prunes empty user/org maps', () => {
    const registry = new ConnectionRegistry();
    const socket = createFakeSocket();

    registry.add('org1', 'user1', socket);
    registry.remove('org1', 'user1', socket);

    expect([...registry.socketsFor('org1', 'user1')]).toEqual([]);
  });

  it('removing one principal leaves other org/user entries intact', () => {
    const registry = new ConnectionRegistry();
    const socketOrg1User1 = createFakeSocket();
    const socketOrg1User2 = createFakeSocket();
    const socketOrg2User1 = createFakeSocket();

    registry.add('org1', 'user1', socketOrg1User1);
    registry.add('org1', 'user2', socketOrg1User2);
    registry.add('org2', 'user1', socketOrg2User1);

    registry.remove('org1', 'user1', socketOrg1User1);

    expect([...registry.socketsFor('org1', 'user1')]).toEqual([]);
    expect([...registry.socketsFor('org1', 'user2')]).toEqual([socketOrg1User2]);
    expect([...registry.socketsFor('org2', 'user1')]).toEqual([socketOrg2User1]);
  });

  it('removing an unknown socket is a no-op', () => {
    const registry = new ConnectionRegistry();
    const registered = createFakeSocket();
    const unknown = createFakeSocket();

    registry.add('org1', 'user1', registered);

    expect(() => registry.remove('org1', 'user1', unknown)).not.toThrow();
    expect([...registry.socketsFor('org1', 'user1')]).toEqual([registered]);
  });

  it('returns an empty iterable for an unknown principal', () => {
    const registry = new ConnectionRegistry();

    expect([...registry.socketsFor('unknown-org', 'unknown-user')]).toEqual([]);
  });
});

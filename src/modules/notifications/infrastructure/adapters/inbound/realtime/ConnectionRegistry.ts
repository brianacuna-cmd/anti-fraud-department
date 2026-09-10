/**
 * Minimal structural socket handle the registry operates on. Deliberately
 * dependency-free (no `ws` import) so this pure, in-memory registry stays
 * unit-testable without the `ws` package, which lands in a later PR that
 * wires a real WebSocket implementation. Any object exposing `close()`
 * satisfies this contract, including real `WebSocket` instances.
 */
export interface RealtimeSocket {
  close(): void;
}

/**
 * Tenant-isolated, in-memory registry of connected sockets, keyed
 * `organizationId -> userId -> Set<socket>`. A notification for
 * (organizationId, userId) is delivered ONLY to that principal's own
 * sockets — `socketsFor` never leaks across organizations or users.
 * Pure infrastructure: zero cross-module imports.
 */
export class ConnectionRegistry<TSocket extends RealtimeSocket = RealtimeSocket> {
  private readonly byOrganization = new Map<string, Map<string, Set<TSocket>>>();

  add(organizationId: string, userId: string, socket: TSocket): void {
    let byUser = this.byOrganization.get(organizationId);
    if (!byUser) {
      byUser = new Map<string, Set<TSocket>>();
      this.byOrganization.set(organizationId, byUser);
    }

    let sockets = byUser.get(userId);
    if (!sockets) {
      sockets = new Set<TSocket>();
      byUser.set(userId, sockets);
    }

    sockets.add(socket);
  }

  remove(organizationId: string, userId: string, socket: TSocket): void {
    const byUser = this.byOrganization.get(organizationId);
    if (!byUser) {
      return;
    }

    const sockets = byUser.get(userId);
    if (!sockets) {
      return;
    }

    sockets.delete(socket);

    if (sockets.size === 0) {
      byUser.delete(userId);
    }

    if (byUser.size === 0) {
      this.byOrganization.delete(organizationId);
    }
  }

  socketsFor(organizationId: string, userId: string): readonly TSocket[] {
    const sockets = this.byOrganization.get(organizationId)?.get(userId);
    return sockets ? [...sockets] : [];
  }
}

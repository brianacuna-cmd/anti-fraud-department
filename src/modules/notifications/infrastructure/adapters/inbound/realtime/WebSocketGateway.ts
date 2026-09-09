import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import type { ConnectionRegistry } from './ConnectionRegistry.js';
import type { SessionAuthenticator } from '../../../../domain/ports/SessionAuthenticator.js';

const SEC_WEBSOCKET_PROTOCOL = 'sec-websocket-protocol';

/**
 * Extracts the handshake token carried in the `Sec-WebSocket-Protocol`
 * header (design ADR-5, locked: query string leaks to logs, and the
 * browser `WebSocket` API cannot set `Authorization`). The upgrade handler
 * only receives raw `http.IncomingMessage` headers, never an Express
 * `Request` — this deliberately takes the plain headers shape rather than
 * `SessionTokenAuthContextResolver.extractBearerToken`'s `Request` param.
 * The client may send a comma-separated protocol list; the first entry is
 * treated as the token.
 */
export function extractHandshakeToken(headers: IncomingMessage['headers']): string | undefined {
  const raw = headers[SEC_WEBSOCKET_PROTOCOL];
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (!value) {
    return undefined;
  }
  const token = value.split(',')[0]?.trim();
  return token && token.length > 0 ? token : undefined;
}

function rejectUpgrade(socket: Socket): void {
  socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
  socket.destroy();
}

export interface WebSocketGatewayDeps {
  readonly server: Server;
  readonly registry: ConnectionRegistry<WebSocket>;
  readonly authenticator: SessionAuthenticator;
}

/**
 * Infrastructure inbound adapter (realtime-ws-gateway design §3b): attaches
 * to an already-listening `http.Server` supplied by the composition root
 * (never creates/listens its own server), authenticates every upgrade via
 * the injected `SessionAuthenticator` local port (no identity-access
 * import — boundaries-spike decision #538), and registers accepted sockets
 * into the shared `ConnectionRegistry` keyed by organization+user. Redis
 * fan-out is wired separately (PR3); `deliverTo` only reaches sockets
 * registered on THIS instance.
 */
export class WebSocketGateway {
  private readonly wss: WebSocketServer;
  private readonly server: Server;
  private readonly registry: ConnectionRegistry<WebSocket>;
  private readonly authenticator: SessionAuthenticator;

  constructor(deps: WebSocketGatewayDeps) {
    this.server = deps.server;
    this.registry = deps.registry;
    this.authenticator = deps.authenticator;
    this.wss = new WebSocketServer({
      noServer: true,
      // Echo back the first offered subprotocol (the token itself) —
      // required by the WS spec or the browser closes the connection
      // (design §3b).
      handleProtocols: (protocols) => {
        const [first] = protocols;
        return first ?? false;
      },
    });
  }

  attach(): void {
    this.server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      void this.handleUpgrade(req, socket, head);
    });
  }

  private async handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    const token = extractHandshakeToken(req.headers);
    if (!token) {
      rejectUpgrade(socket);
      return;
    }

    const principal = await this.authenticator.authenticate(token);
    if (!principal) {
      rejectUpgrade(socket);
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
      this.registry.add(principal.organizationId, principal.userId, ws);

      const deregister = (): void => {
        this.registry.remove(principal.organizationId, principal.userId, ws);
      };
      ws.on('close', deregister);
      ws.on('error', deregister);
    });
  }

  /**
   * Delivers `payload` (JSON-serialized) to every socket registered on
   * THIS instance for (organizationId, userId). A no-op when no matching
   * socket is connected locally — never throws.
   */
  deliverTo(organizationId: string, userId: string, payload: unknown): void {
    const message = JSON.stringify(payload);
    for (const socket of this.registry.socketsFor(organizationId, userId)) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    }
  }
}

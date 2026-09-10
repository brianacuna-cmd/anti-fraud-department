/**
 * Local authentication port for the realtime WS gateway (boundaries-spike
 * decision #538): `notifications/infrastructure` may NOT import
 * identity-access domain ports directly (eslint-plugin-boundaries forbids
 * cross-module domain/application/infrastructure imports). The gateway
 * depends ONLY on this local port; the real implementation bridging to
 * identity-access's `SessionTokenService`/`SessionRepository` is wired in
 * `src/composition/` (unconstrained by the boundaries rule), same pattern
 * as the existing `notificationEmailSenderAdapter.ts`.
 */
export interface AuthenticatedPrincipal {
  readonly organizationId: string;
  readonly userId: string;
}

export interface SessionAuthenticator {
  /**
   * Resolves `token` (as carried by the WS handshake's
   * `Sec-WebSocket-Protocol` header) to its principal. Returns `null` for
   * any failure — missing/invalid/expired/revoked — never throws.
   */
  authenticate(token: string): Promise<AuthenticatedPrincipal | null>;
}

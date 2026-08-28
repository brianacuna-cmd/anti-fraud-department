/**
 * Reading correlation keys out of Finturu/Bridge/Stripe payloads.
 *
 * Both sync use cases (`SyncFinturuData`, `SyncFinturuDirectory`) correlate the
 * same untyped bags against the same register, so they read them the same way.
 * Keeping one copy each was not only duplication: the snake_case fallback below
 * was a bug fix, and a fix that lands in one copy and not the other comes back
 * as "half the transfers correlate".
 */

/**
 * Reads a correlation key from an untyped object (Stripe `metadata`,
 * a transfer's `source`/`destination`). Returns `null` if missing, so the
 * caller never compares `undefined` against a Set.
 *
 * Accepts a number as well as text: Finturu's register types the SAME field
 * as a number in some payloads and as a string in others, and discarding the
 * numeric variant would leave half the customers uncorrelated.
 *
 * Exact lookup only — `readKey` is the one that also tries the snake_case
 * spelling.
 */
export function readExactKey(
  bag: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = bag?.[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** `bridgeWalletId` -> `bridge_wallet_id`. */
function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Same lookup, but also trying the `snake_case` spelling.
 *
 * Finturu normalizes the transfer's outer layer to camelCase (`idTransfer`,
 * `clientReferenceId`) but forwards `source`/`destination` exactly as they
 * arrive from Bridge, where the keys are `bridge_wallet_id`, `from_address`
 * and `to_address`. Looking only in camelCase made NO transfer match its
 * customer: the directory stored `transfers: []` for the whole register and
 * the Movements tab came up empty.
 */
export function readKey(bag: Record<string, unknown> | undefined, key: string): string | null {
  const snake = toSnakeCase(key);
  return readExactKey(bag, key) ?? (snake === key ? null : readExactKey(bag, snake));
}

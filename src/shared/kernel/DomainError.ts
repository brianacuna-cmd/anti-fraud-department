/**
 * Base class for every domain error across `identity-access` and future
 * modules. A module's closed error-code union (e.g. `IdentityAccessErrorCode`)
 * is what actually enforces "closed set of errors" — this class only carries
 * the shared shape: `code`, `message`, `metadata`.
 *
 * Deliberately has NO `httpStatus` field (design decision D5): mapping a code
 * to an HTTP status is an HTTP-layer concern (`shared/http/errorHandler.ts`),
 * never a domain concern.
 */
export abstract class DomainError extends Error {
  readonly code: string;
  readonly metadata: Readonly<Record<string, unknown>>;

  protected constructor(
    code: string,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.metadata = metadata;
  }
}

import type { ErrorRequestHandler } from 'express';
import { DomainError } from '../kernel/DomainError.js';

/** Maps a module's closed error-code union to an HTTP status. */
export type StatusByCode = Readonly<Record<string, number>>;

/**
 * Express error-handling middleware factory. Must be registered LAST in the
 * app (design: "errorHandler last"). Serializes `DomainError` as
 * `{ error: { code, message, metadata } }`; anything else becomes a generic
 * `500 INTERNAL` so raw driver/framework details never reach the client.
 */
export function createErrorHandler(statusByCode: StatusByCode): ErrorRequestHandler {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err, _req, res, _next) => {
    if (err instanceof DomainError) {
      const status = statusByCode[err.code] ?? 500;
      res.status(status).json({
        error: { code: err.code, message: err.message, metadata: err.metadata },
      });
      return;
    }

    // Non-DomainError = programming defect: the client gets the opaque 500,
    // but the stack MUST stay in the server log or the error is
    // undiagnosable (nothing else catches it).
    console.error('[errorHandler] unhandled non-domain error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL', message: 'Internal server error', metadata: {} },
    });
  };
}

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

    // Non-DomainError = defecto de programación: el cliente recibe el 500
    // opaco, pero el stack DEBE quedar en el log del servidor o el error es
    // indiagnosticable (nada más lo captura).
    console.error('[errorHandler] unhandled non-domain error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL', message: 'Internal server error', metadata: {} },
    });
  };
}

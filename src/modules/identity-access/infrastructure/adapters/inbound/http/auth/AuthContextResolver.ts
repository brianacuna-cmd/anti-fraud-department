import type { Request } from 'express';
import type { AuthContext } from '../../../../../../../shared/kernel/AuthContext.js';

/**
 * Resolves the current request's `AuthContext`, or `null` if it cannot be
 * resolved (design D4, D12). `resolve` is async — a real session-backed
 * resolver needs a `Sessions` read, and every implementation (including
 * `TrustedHeaderAuthContextResolver`, which needs no I/O) shares one
 * signature so `authContextMiddleware` and every route stay the same
 * regardless of which resolver is active.
 */
export interface AuthContextResolver {
  resolve(req: Request): Promise<AuthContext | null>;
}

import type { Request } from 'express';
import type { AuthContext } from '../../../../../../../shared/kernel/AuthContext.js';

/**
 * Resolves the current request's `AuthContext`, or `null` if it cannot be
 * resolved (design D4). Real JWT middleware later swaps the concrete
 * implementation only — `authContextMiddleware` and every route stay the
 * same.
 */
export interface AuthContextResolver {
  resolve(req: Request): AuthContext | null;
}

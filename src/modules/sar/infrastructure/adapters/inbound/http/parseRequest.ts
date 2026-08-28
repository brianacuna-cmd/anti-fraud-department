import type { ZodType } from 'zod';
import { invariantViolation } from '../../../../domain/errors/SarError.js';

/**
 * Parses transport input against a zod schema, translating any failure into
 * `INVARIANT_VIOLATION` (mirrors risk-assessment's `parseRequest`) so it
 * flows through the same `errorHandler` as every other domain error.
 */
export function parseRequest<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw invariantViolation('invalid request payload', { issues: result.error.issues });
  }
  return result.data;
}

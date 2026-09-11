import type { ZodType } from 'zod';
import { invariantViolation } from '../../../../domain/errors/AuditError.js';

/** Traduce cualquier fallo de zod a `INVARIANT_VIOLATION`. */
export function parseRequest<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw invariantViolation('invalid request payload', { issues: result.error.issues });
  }
  return result.data;
}

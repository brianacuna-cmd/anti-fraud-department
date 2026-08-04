import type { ZodType } from 'zod';
import { invariantViolation } from '../../../../domain/errors/IdentityAccessError.js';

/**
 * Parses transport input against a zod schema, translating any failure into
 * `INVARIANT_VIOLATION` (design Open Question, resolved: "VO/zod guard
 * failures need a code") so it flows through the same `errorHandler` as
 * every other domain error, instead of an unmapped `ZodError` -> 500.
 */
export function parseRequest<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw invariantViolation('invalid request payload', { issues: result.error.issues });
  }
  return result.data;
}

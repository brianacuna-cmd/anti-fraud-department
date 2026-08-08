import { z } from 'zod';

/** POST /users body. `middleName` is nullable/optional (design A12), no non-empty rule when omitted or null. */
export const createUserSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  firstName: z.string().min(1),
  middleName: z.string().min(1).nullish(),
  lastName: z.string().min(1),
  avatarUrl: z.string().min(1).nullish(),
});

export type CreateUserBody = z.infer<typeof createUserSchema>;

/**
 * PATCH /users/:id body. `.strict()` enforces the allow-list at the
 * transport boundary (user-lifecycle spec: "User Identity Patch" — ONLY
 * firstName/lastName/email/middleName/avatarUrl (design A12 adds
 * `middleName` explicitly to the allow-list); roleId, mfa,
 * notificationPreferences, passwordHash, passwordSalt, resetToken,
 * loginAttempts, lockedUntil, and lastLogin MUST NOT be alterable through
 * this route (design A11).
 */
export const patchUserSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    middleName: z.string().min(1).nullish(),
    avatarUrl: z.string().min(1).nullish(),
  })
  .strict();

export type PatchUserBody = z.infer<typeof patchUserSchema>;

/** POST /users/:id/transition body. */
export const transitionUserSchema = z.object({
  next: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DISABLED']),
});

export type TransitionUserBody = z.infer<typeof transitionUserSchema>;

/** POST /users/me/mfa/activate body (mfa-user-enrollment PR2). */
export const activateMfaSchema = z.object({
  token: z.string().min(1),
});

export type ActivateMfaBody = z.infer<typeof activateMfaSchema>;

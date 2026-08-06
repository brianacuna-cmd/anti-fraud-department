import { z } from 'zod';

/** POST /users body. */
export const createUserSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  avatarUrl: z.string().min(1).nullish(),
});

export type CreateUserBody = z.infer<typeof createUserSchema>;

/**
 * PATCH /users/:id body. `.strict()` enforces the allow-list at the
 * transport boundary (user-lifecycle spec: "User Identity Patch" — ONLY
 * firstName/lastName/email/avatarUrl; roleIds, mfa, notificationPreferences,
 * passwordHash, passwordSalt, resetToken fields, loginAttempts, lockedUntil,
 * and lastLogin MUST NOT be alterable through this route.
 */
export const patchUserSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    avatarUrl: z.string().min(1).nullish(),
  })
  .strict();

export type PatchUserBody = z.infer<typeof patchUserSchema>;

/** POST /users/:id/transition body. */
export const transitionUserSchema = z.object({
  next: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DISABLED']),
});

export type TransitionUserBody = z.infer<typeof transitionUserSchema>;

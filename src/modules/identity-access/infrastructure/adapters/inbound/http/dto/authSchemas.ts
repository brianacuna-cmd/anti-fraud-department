import { z } from 'zod';

/**
 * POST /auth/users/login body — `organizationSlug` is REQUIRED (design D29):
 * `Users.Email` is per-tenant, so a login attempt must carry a tenant
 * discriminator; there is no cross-tenant email lookup to fall back to.
 */
export const usersLoginSchema = z.object({
  organizationSlug: z.string().min(1),
  email: z.string().min(1),
  password: z.string().min(1),
});

export type UsersLoginBody = z.infer<typeof usersLoginSchema>;

/** POST /auth/organizations/login body — Organizations keep single-field unique Email (design D29), no tenant discriminator needed. */
export const organizationsLoginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export type OrganizationsLoginBody = z.infer<typeof organizationsLoginSchema>;

/**
 * POST /auth/users/mfa body (two-step-login PR2, design "IssueSession
 * flow") — the challenge token travels in the BODY, not as a Bearer header
 * (design D5: this route is public like /login, no `AuthContext` exists
 * yet).
 */
export const usersMfaSchema = z.object({
  challengeToken: z.string().min(1),
  totp: z.string().min(1),
});

export type UsersMfaBody = z.infer<typeof usersMfaSchema>;

/**
 * POST /auth/users/password-reset/request body (password-management PR-2b,
 * design §6/§5). `organizationSlug` is deliberately OPTIONAL here, unlike
 * `usersLoginSchema` — an absent slug must resolve to the SAME opaque
 * no-match path as an unknown one (spec "Unknown email, unknown
 * organizationSlug, or missing organizationSlug"), not a 400 at the DTO
 * boundary, or the response shape would leak which case occurred.
 */
export const requestPasswordResetSchema = z.object({
  organizationSlug: z.string().optional(),
  email: z.string().min(1),
});

export type RequestPasswordResetBody = z.infer<typeof requestPasswordResetSchema>;

/**
 * POST /auth/users/password-reset/confirm body (password-management PR-2c,
 * spec "Confirm Password Reset"). Deliberately NO `organizationSlug` —
 * unlike `usersLoginSchema`/`requestPasswordResetSchema`, the tenant is
 * derived entirely from the token's own claims (design §6), so a slug field
 * here would be dead input.
 */
export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(1),
});

export type ConfirmPasswordResetBody = z.infer<typeof confirmPasswordResetSchema>;

/**
 * POST /auth/refresh body (session-lifecycle PR-2, design "3. `/auth/refresh`
 * route + DTO"). Bearer-in-body convention, same as `usersMfaSchema` /
 * `confirmPasswordResetSchema` — the route is UNAUTHENTICATED, no
 * `AuthContext` exists yet, and the refresh token itself IS the credential.
 */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshBody = z.infer<typeof refreshSchema>;

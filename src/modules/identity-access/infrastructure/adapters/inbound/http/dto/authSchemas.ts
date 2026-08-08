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

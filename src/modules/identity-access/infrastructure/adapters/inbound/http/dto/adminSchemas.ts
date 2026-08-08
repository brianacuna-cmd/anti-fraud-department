import { z } from 'zod';

/**
 * POST /admin-organizations body (design D31/D32, PR 1c scope). Only `email`
 * is caller-supplied — the keypair is generated server-side and never
 * accepted as input.
 */
export const provisionAdminOrganizationSchema = z.object({
  email: z.string().min(1),
});

export type ProvisionAdminOrganizationBody = z.infer<typeof provisionAdminOrganizationSchema>;

/**
 * POST /admin-organizations/challenges body (design super-admin-auth PR1,
 * "HTTP"). Public/unauthenticated — step 1 of PLATFORM_ADMIN challenge-login.
 */
export const requestAdminChallengeSchema = z.object({
  adminOrganizationId: z.string().min(1),
});

export type RequestAdminChallengeBody = z.infer<typeof requestAdminChallengeSchema>;

/**
 * POST /admin-organizations/sessions body (design super-admin-auth PR1,
 * "HTTP"). Public/unauthenticated — step 2 of PLATFORM_ADMIN challenge-login.
 */
export const verifyAdminChallengeSchema = z.object({
  challengeId: z.string().min(1),
  signature: z.string().min(1),
});

export type VerifyAdminChallengeBody = z.infer<typeof verifyAdminChallengeSchema>;

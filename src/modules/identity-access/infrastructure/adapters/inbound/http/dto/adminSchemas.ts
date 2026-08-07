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

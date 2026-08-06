import { z } from 'zod';

/**
 * POST /organizations body (organization-lifecycle spec: "Atomic
 * Organization Bootstrap") — creates the organization AND its first admin
 * user in one request/transaction, so the admin's identity fields are
 * required here too (task 3.30: REPLACES Phase 2's simple `CreateOrganization`
 * wiring for this route).
 */
export const createOrganizationSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  domain: z.string().min(1).nullish(),
  adminEmail: z.string().min(1),
  adminPassword: z.string().min(1),
  adminFirstName: z.string().min(1),
  adminLastName: z.string().min(1),
});

export type CreateOrganizationBody = z.infer<typeof createOrganizationSchema>;

/**
 * PATCH /organizations/:id body. `.strict()` enforces the allow-list at the
 * transport boundary (organization-lifecycle spec: "Organization Identity
 * Patch" — slug immutable, only name/domain may change). `logoUrl` is
 * removed with no replacement DTO field (design D8); `configuration` is
 * persistence/domain-only and never exposed over HTTP (design A11).
 */
export const patchOrganizationSchema = z
  .object({
    name: z.string().min(1).optional(),
    domain: z.string().min(1).nullish(),
  })
  .strict();

export type PatchOrganizationBody = z.infer<typeof patchOrganizationSchema>;

/**
 * PATCH /organizations/:id/status body (design D10, D21 — supersedes
 * `POST /organizations/:id/transition`'s `{ next }` shape). Organization's
 * own 3-value status set, distinct from the shared `LifecycleStatus`.
 */
export const updateOrganizationStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CANCELLED']),
});

export type UpdateOrganizationStatusBody = z.infer<typeof updateOrganizationStatusSchema>;

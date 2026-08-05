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
  logoUrl: z.string().min(1).nullish(),
  adminEmail: z.string().min(1),
  adminPassword: z.string().min(1),
  adminFirstName: z.string().min(1),
  adminLastName: z.string().min(1),
});

export type CreateOrganizationBody = z.infer<typeof createOrganizationSchema>;

/**
 * PATCH /organizations/:id body. `.strict()` enforces the allow-list at the
 * transport boundary (organization-lifecycle spec: "Organization Identity
 * Patch" — slug immutable, only name/domain/logoUrl may change).
 */
export const patchOrganizationSchema = z
  .object({
    name: z.string().min(1).optional(),
    domain: z.string().min(1).nullish(),
    logoUrl: z.string().min(1).nullish(),
  })
  .strict();

export type PatchOrganizationBody = z.infer<typeof patchOrganizationSchema>;

/** POST /organizations/:id/transition body. */
export const transitionOrganizationSchema = z.object({
  next: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DISABLED']),
});

export type TransitionOrganizationBody = z.infer<typeof transitionOrganizationSchema>;

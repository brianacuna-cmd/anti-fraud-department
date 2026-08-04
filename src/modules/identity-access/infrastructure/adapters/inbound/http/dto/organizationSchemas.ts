import { z } from 'zod';

/** POST /organizations body (organization half of the atomic bootstrap). */
export const createOrganizationSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  domain: z.string().min(1).nullish(),
  logoUrl: z.string().min(1).nullish(),
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
  next: z.enum(['ACTIVO', 'INACTIVO', 'SUSPENDIDO', 'DESHABILITADO']),
});

export type TransitionOrganizationBody = z.infer<typeof transitionOrganizationSchema>;

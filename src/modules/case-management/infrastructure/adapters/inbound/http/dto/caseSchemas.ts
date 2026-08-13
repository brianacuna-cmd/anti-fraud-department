import { z } from 'zod';

/**
 * POST /cases body (T5 manual case creation). `finturuCacheSnapshot` is
 * deliberately NOT exposed here — Slice 5 is manual creation only, that
 * field is only ever populated by an automated intake path (out of scope).
 */
export const createCaseSchema = z.object({
  customerId: z.string().min(1),
  riskScore: z.number().int().min(0).max(100),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  customerEmail: z.string().min(1).nullish(),
  bridgeUserId: z.string().min(1).nullish(),
  bridgeWallet: z.string().min(1).nullish(),
  stripeCustomerId: z.string().min(1).nullish(),
  tags: z.array(z.string().min(1)).optional(),
});

export type CreateCaseBody = z.infer<typeof createCaseSchema>;

/** POST /cases/:caseId/reassign body (manual reassignment). */
export const reassignCaseSchema = z.object({
  assignedToType: z.enum(['USER', 'ROLE']),
  assignedToId: z.string().min(1),
});

export type ReassignCaseBody = z.infer<typeof reassignCaseSchema>;

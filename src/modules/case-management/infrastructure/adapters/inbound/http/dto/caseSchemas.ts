import { z } from 'zod';

/**
 * POST /cases body (T5 manual case creation). `finturuCacheSnapshot` is
 * deliberately NOT exposed here — only the composition score→case
 * orchestrator may pass it into CreateCase application input.
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

const caseStatusEnum = z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'ARCHIVED']);
const casePriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/** Coerces Express query `string | string[]` into a string array. */
function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

/**
 * GET /cases query (inbox). `organization_id` comes from the tenant auth
 * context — not from the query string.
 */
export const listCasesQuerySchema = z.object({
  customerId: z.string().min(1).optional(),
  status: z.preprocess(asStringArray, z.array(caseStatusEnum).optional()),
  priority: z.preprocess(asStringArray, z.array(casePriorityEnum).optional()),
  assignedTo: z.string().min(1).optional(),
  riskScoreMin: z.coerce.number().int().min(0).max(100).optional(),
  riskScoreMax: z.coerce.number().int().min(0).max(100).optional(),
  tags: z.preprocess(asStringArray, z.array(z.string().min(1)).optional()),
  dueAfter: z.iso.datetime().optional(),
  dueBefore: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListCasesQuery = z.infer<typeof listCasesQuerySchema>;

/**
 * GET /cases/export query. Same filters as the inbox list (no pagination —
 * export returns all matching cases up to the use-case cap) plus a `format`
 * selector. `organization_id` comes from the tenant auth context.
 */
export const exportCasesQuerySchema = z.object({
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
  status: z.preprocess(asStringArray, z.array(caseStatusEnum).optional()),
  priority: z.preprocess(asStringArray, z.array(casePriorityEnum).optional()),
  assignedTo: z.string().min(1).optional(),
  riskScoreMin: z.coerce.number().int().min(0).max(100).optional(),
  riskScoreMax: z.coerce.number().int().min(0).max(100).optional(),
  tags: z.preprocess(asStringArray, z.array(z.string().min(1)).optional()),
  dueAfter: z.iso.datetime().optional(),
  dueBefore: z.iso.datetime().optional(),
});

export type ExportCasesQuery = z.infer<typeof exportCasesQuerySchema>;

/** POST /cases/:caseId/reopen body (role-gated reopen + SLA reset). */
export const reopenCaseSchema = z.object({
  targetStatus: z.enum(['OPEN', 'IN_REVIEW']),
  justification: z.string().trim().min(1),
});

export type ReopenCaseBody = z.infer<typeof reopenCaseSchema>;

/** PATCH /cases/:caseId/priority-tags body (retag + reprioritize, SLA recalc). */
export const updateCasePriorityTagsSchema = z.object({
  priority: casePriorityEnum,
  tags: z.array(z.string().trim().min(1)),
});

export type UpdateCasePriorityTagsBody = z.infer<typeof updateCasePriorityTagsSchema>;

/**
 * POST /cases/bulk-action body. Exactly one action applied to a selection of
 * cases. `caseIds` is bounded to keep a single transaction reasonable.
 */
export const bulkCaseActionSchema = z.object({
  caseIds: z.array(z.string().min(1)).min(1).max(100),
  action: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('ASSIGN'),
      assignedToType: z.enum(['USER', 'ROLE']),
      assignedToId: z.string().min(1),
    }),
    z.object({
      type: z.literal('CHANGE_PRIORITY'),
      priority: casePriorityEnum,
    }),
    z.object({
      type: z.literal('ADD_TAGS'),
      tags: z.array(z.string().trim().min(1)).min(1),
    }),
  ]),
});

export type BulkCaseActionBody = z.infer<typeof bulkCaseActionSchema>;

/** POST /cases/:caseId/notes body. */
export const addCaseNoteSchema = z.object({
  body: z.string().trim().min(1),
});

export type AddCaseNoteBody = z.infer<typeof addCaseNoteSchema>;

/** POST /cases/:caseId/resolve and /archive body (formal closure). */
export const closeCaseSchema = z.object({
  reason: z.string().trim().min(1),
});

export type CloseCaseBody = z.infer<typeof closeCaseSchema>;

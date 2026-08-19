import { z } from 'zod';

const decisionEnum = z.enum(['FRAUD_CONFIRMED', 'FALSE_POSITIVE', 'INCONCLUSIVE']);
const actionTypeEnum = z.enum(['BLOCK', 'RESTRICT', 'SUSPEND', 'DELETE', 'REVIEW']);

/**
 * POST /cases/:caseId/decisions body.
 * FRAUD_CONFIRMED requires actionType + target fields (enforced in use case
 * after Zod accepts optional fields for non-confirm decisions).
 */
export const recordAnalystDecisionSchema = z.object({
  decision: decisionEnum,
  confidence: z.number().min(0).max(100),
  comment: z.string(),
  actionType: actionTypeEnum.optional(),
  targetType: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
});

export type RecordAnalystDecisionBody = z.infer<typeof recordAnalystDecisionSchema>;

/** POST /enforcement-actions/:id/approve|reject body. */
export const reviewEnforcementActionSchema = z.object({
  reviewerComment: z.string().nullable().optional(),
});

export type ReviewEnforcementActionBody = z.infer<typeof reviewEnforcementActionSchema>;

const enforcementStatusEnum = z.enum(['PENDING', 'APPROVED', 'EXECUTED', 'REJECTED']);

/**
 * GET /enforcement-actions query. `organization_id` comes from the tenant auth
 * context — not from the query string. Filter the history by entity
 * (`targetType`/`targetId`), lifecycle `status`, `actionType`, or `caseId`.
 */
export const listEnforcementActionsQuerySchema = z.object({
  status: enforcementStatusEnum.optional(),
  actionType: actionTypeEnum.optional(),
  targetType: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
  caseId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListEnforcementActionsQuery = z.infer<typeof listEnforcementActionsQuerySchema>;

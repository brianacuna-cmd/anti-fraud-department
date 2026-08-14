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

import { z } from 'zod';
import { jdmGraphSchema, type JdmGraph } from '../../../../../../../shared/http/dto/jdmGraphSchema.js';

export { jdmGraphSchema, type JdmGraph };

/**
 * POST /case-routing-rules body. Persists as INACTIVE draft after structural
 * JDM validation.
 */
export const createRoutingRuleSchema = z
  .object({
    name: z.string().min(1),
    conditions: jdmGraphSchema,
    conditionsVersion: z.number().int().nonnegative().optional(),
    targetRoleId: z.string().min(1).nullable().optional(),
    targetUserId: z.string().min(1).nullable().optional(),
  })
  .strict();

export type CreateRoutingRuleBody = z.infer<typeof createRoutingRuleSchema>;

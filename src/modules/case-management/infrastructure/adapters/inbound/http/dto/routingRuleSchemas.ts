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

/**
 * POST /case-routing-rules/priority-mapping body. One row per priority; the
 * JDM graph is generated server-side (`CreatePriorityAssignmentRule.ts`),
 * so this schema validates the simple mapping shape, not a JDM graph.
 */
export const createPriorityAssignmentRuleSchema = z
  .object({
    name: z.string().min(1),
    mappings: z
      .array(
        z
          .object({
            priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
            target: z
              .object({
                type: z.enum(['USER', 'ROLE']),
                id: z.string().min(1),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type CreatePriorityAssignmentRuleBody = z.infer<typeof createPriorityAssignmentRuleSchema>;

/**
 * POST /case-routing-rules/simulate body — the decision editor's dry run.
 *
 * `case` is the context `ZenRoutingEngine` puts in front of the graph, field
 * for field: testing against a different shape would give false confidence.
 */
export const simulateRoutingRuleSchema = z
  .object({
    conditions: jdmGraphSchema,
    case: z
      .object({
        riskScore: z.number().int().min(0).max(100),
        status: z.string().min(1),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
        tags: z.array(z.string()).default([]),
      })
      .strict(),
  })
  .strict();

export type SimulateRoutingRuleBody = z.infer<typeof simulateRoutingRuleSchema>;

/**
 * PATCH /case-routing-rules/:id body. All fields optional. Status and
 * executionOrder are rejected via `.strict()` — activate/deactivate and
 * reorder own those transitions.
 */
export const updateRoutingRuleSchema = z
  .object({
    name: z.string().min(1).optional(),
    conditions: jdmGraphSchema.optional(),
    targetRoleId: z.string().min(1).nullable().optional(),
    targetUserId: z.string().min(1).nullable().optional(),
  })
  .strict();

export type UpdateRoutingRuleBody = z.infer<typeof updateRoutingRuleSchema>;

/**
 * PUT /case-routing-rules/reorder body. Full-org permutation of catalog ids.
 */
export const reorderRoutingRulesSchema = z
  .object({
    ids: z.array(z.string().min(1)),
  })
  .strict();

export type ReorderRoutingRulesBody = z.infer<typeof reorderRoutingRulesSchema>;

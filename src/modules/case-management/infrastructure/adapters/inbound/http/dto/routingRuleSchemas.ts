import { z } from 'zod';

/**
 * Structural JDM graph validation for routing-rule create (design ADR A6:
 * clone of scoring `jdmGraphSchema` — shape only, not semantic correctness).
 */
export const jdmGraphSchema = z
  .object({
    contentType: z.literal('application/vnd.gorules.decision'),
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            type: z.string().min(1),
            name: z.string().optional(),
            position: z.object({ x: z.number(), y: z.number() }).optional(),
            content: z.unknown().optional(),
          })
          .passthrough(),
      )
      .min(1),
    edges: z.array(
      z
        .object({
          id: z.string().min(1),
          sourceId: z.string().min(1),
          targetId: z.string().min(1),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type JdmGraph = z.infer<typeof jdmGraphSchema>;

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

import { z } from 'zod';

/**
 * Structural JDM graph validation for scoring-rule create (design:
 * shape only — not semantic correctness / Expression riskScore).
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
 * POST /risk-scoring-rules body. Persists as INACTIVE draft after structural
 * JDM validation.
 */
export const createScoringRuleSchema = z
  .object({
    name: z.string().min(1),
    conditions: jdmGraphSchema,
    conditionsVersion: z.number().int().nonnegative().optional(),
  })
  .strict();

export type CreateScoringRuleBody = z.infer<typeof createScoringRuleSchema>;

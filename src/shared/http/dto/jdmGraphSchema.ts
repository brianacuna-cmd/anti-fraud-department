import { z } from 'zod';

/**
 * Structural JDM graph validation shared by routing-rule and scoring-rule
 * create schemas — shape only, not semantic correctness.
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

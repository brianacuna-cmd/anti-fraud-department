import { z } from 'zod';
import { jdmGraphSchema, type JdmGraph } from '../../../../../../../shared/http/dto/jdmGraphSchema.js';

import { calculateRiskScoreSchema } from './riskScoreSchemas.js';

export { jdmGraphSchema, type JdmGraph };

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

/**
 * POST /risk-scoring-rules/simulate body — the decision editor's dry run.
 *
 * Reuses `calculateRiskScoreSchema` for the event instead of declaring a
 * parallel one: if the dry run accepted an event the real route rejects, it
 * would be testing something that cannot happen.
 */
export const simulateScoringRuleSchema = z
  .object({
    conditions: jdmGraphSchema,
    event: calculateRiskScoreSchema,
  })
  .strict();

export type SimulateScoringRuleBody = z.infer<typeof simulateScoringRuleSchema>;

/**
 * POST /risk-scoring-rules/factor-scoring body — the guided builder. The
 * JDM graph is assembled server-side (`CreateFactorScoringRule.ts`), so
 * unlike `createScoringRuleSchema` this never touches `jdmGraphSchema`.
 */
export const factorScoringRuleSchema = z
  .object({
    name: z.string().min(1),
    factors: z
      .array(
        z
          .object({
            field: z.string().min(1),
            operator: z.enum(['GT', 'GTE', 'LT', 'LTE', 'EQ', 'NEQ', 'CONTAINS', 'IN', 'BETWEEN']),
            value: z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.array(z.union([z.string(), z.number()])),
            ]),
            points: z.number().int().min(-100).max(100),
            reason: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type FactorScoringRuleBody = z.infer<typeof factorScoringRuleSchema>;

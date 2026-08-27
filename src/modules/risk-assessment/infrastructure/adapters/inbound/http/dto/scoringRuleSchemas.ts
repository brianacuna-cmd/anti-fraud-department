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
 * POST /risk-scoring-rules/simulate body — ensayo en seco desde el editor.
 *
 * Reutiliza `calculateRiskScoreSchema` para el evento en lugar de declarar
 * uno paralelo: si la prueba admitiera un evento que la ruta real rechaza,
 * probaría algo que no puede ocurrir.
 */
export const simulateScoringRuleSchema = z
  .object({
    conditions: jdmGraphSchema,
    event: calculateRiskScoreSchema,
  })
  .strict();

export type SimulateScoringRuleBody = z.infer<typeof simulateScoringRuleSchema>;

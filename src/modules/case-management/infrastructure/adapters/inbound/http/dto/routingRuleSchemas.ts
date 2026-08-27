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
 * POST /case-routing-rules/priority-mapping body — el atajo del panel.
 *
 * A diferencia de `createRoutingRuleSchema`, aquí NO viaja un grafo JDM: llega
 * el mapeo prioridad -> destino y el grafo lo arma el dominio
 * (`buildPriorityRoutingJdm`). El cliente describe la intención; la forma de la
 * regla la decide quien la va a evaluar.
 */
export const createPriorityMappingRuleSchema = z
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

export type CreatePriorityMappingRuleBody = z.infer<typeof createPriorityMappingRuleSchema>;

/**
 * POST /case-routing-rules/simulate body — ensayo en seco desde el editor.
 *
 * `case` es el contexto que `ZenRoutingEngine` pone delante del grafo, campo
 * por campo: probar con una forma distinta a la real daría confianza falsa.
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

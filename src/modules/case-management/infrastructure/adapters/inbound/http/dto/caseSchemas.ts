import { z } from 'zod';

/**
 * POST /cases body (T5 manual case creation). `finturuCacheSnapshot` is
 * deliberately NOT exposed here — Slice 5 is manual creation only, that
 * field is only ever populated by an automated intake path (out of scope).
 */
export const createCaseSchema = z.object({
  customerId: z.string().min(1),
  riskScore: z.number().int().min(0).max(100),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  customerEmail: z.string().min(1).nullish(),
  bridgeUserId: z.string().min(1).nullish(),
  bridgeWallet: z.string().min(1).nullish(),
  stripeCustomerId: z.string().min(1).nullish(),
  tags: z.array(z.string().min(1)).optional(),
});

export type CreateCaseBody = z.infer<typeof createCaseSchema>;

/**
 * PATCH /cases/:id/priority-tags body (CASE-007).
 *
 * Ambos campos son opcionales, pero al menos uno debe venir: un PATCH vacio
 * no es una peticion valida sino un error del llamante, y aceptarlo en
 * silencio devolveria 200 sin haber hecho nada.
 *
 * `tags` admite el array vacio a proposito — es como se limpian todas las
 * etiquetas de un caso; `.nullish()` no serviria para expresar eso.
 */
export const reclassifyCaseSchema = z
  .object({
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    tags: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine((body) => body.priority !== undefined || body.tags !== undefined, {
    message: 'Debe indicarse priority, tags, o ambos',
  });

export type ReclassifyCaseBody = z.infer<typeof reclassifyCaseSchema>;

/**
 * POST /cases/:id/reopen body (CASE-009). Todo es opcional: reabrir sin
 * cuerpo es la peticion normal desde la interfaz.
 *
 * `nextStatus` se limita a OPEN e IN_REVIEW porque son los unicos destinos
 * que la tabla de transiciones admite desde RESOLVED o ARCHIVED; aceptar el
 * resto aqui solo trasladaria el rechazo al dominio con un error peor.
 */
export const reopenCaseSchema = z.object({
  nextStatus: z.enum(['OPEN', 'IN_REVIEW']).optional(),
  reason: z.string().min(1).max(2000).optional(),
});

export type ReopenCaseBody = z.infer<typeof reopenCaseSchema>;

/**
 * POST /cases/bulk-action body (CASE-012).
 *
 * `superRefine` en lugar de un `refine` por campo: cada accion exige un
 * parametro distinto, y validarlo aqui deja que el error senale exactamente
 * que falta en vez de dejar que el caso de uso falle una vez por cada caso
 * del lote.
 */
export const bulkCaseActionSchema = z
  .object({
    caseIds: z.array(z.string().min(1)).min(1).max(500),
    action: z.enum(['REASSIGN', 'SET_PRIORITY', 'ADD_TAGS', 'REMOVE_TAGS']),
    assignedTo: z
      .object({ type: z.enum(['USER', 'ROLE']), id: z.string().min(1) })
      .nullish(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    tags: z.array(z.string().min(1)).max(50).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.action === 'SET_PRIORITY' && body.priority === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priority'], message: 'SET_PRIORITY requiere priority' });
    }
    if ((body.action === 'ADD_TAGS' || body.action === 'REMOVE_TAGS') && !body.tags?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tags'], message: `${body.action} requiere tags` });
    }
    // REASSIGN admite `assignedTo: null` a proposito: asi se libera un lote
    // entero a la bandeja general. Solo se rechaza omitir el campo del todo.
    if (body.action === 'REASSIGN' && body.assignedTo === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assignedTo'],
        message: 'REASSIGN requiere assignedTo (usa null para liberar a la bandeja general)',
      });
    }
  });

export type BulkCaseActionBody = z.infer<typeof bulkCaseActionSchema>;

/** Condiciones de una regla de enrutamiento (CASE-002). Conjunto cerrado. */
const routingConditionsSchema = z.object({
  riskScoreMin: z.number().int().min(0).max(100).optional(),
  riskScoreMax: z.number().int().min(0).max(100).optional(),
  priorities: z.array(z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])).optional(),
  tags: z.array(z.string().min(1)).max(50).optional(),
  customerEmailDomain: z.string().min(1).optional(),
  hasStripeCustomer: z.boolean().optional(),
  hasBridgeWallet: z.boolean().optional(),
});

export const upsertRoutingRuleSchema = z.object({
  name: z.string().min(1).max(120),
  evaluationOrder: z.number().int().min(0),
  conditions: routingConditionsSchema.default({}),
  assignTo: z.object({ type: z.enum(['USER', 'ROLE']), id: z.string().min(1) }),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const setRoutingRuleStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

export type UpsertRoutingRuleBody = z.infer<typeof upsertRoutingRuleSchema>;

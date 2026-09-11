import { z } from 'zod';

const ACTOR_TYPES = ['USER', 'ORGANIZATION', 'PLATFORM_ADMIN'] as const;

/** Filtros comunes a la consulta y al export. */
const filters = {
  actorId: z.string().min(1).optional(),
  actorType: z.enum(ACTOR_TYPES).optional(),
  action: z.string().min(1).optional(),
  resource: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  ipAddress: z.string().min(1).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
};

export const queryAuditLogsSchema = z
  .object({
    ...filters,
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

/**
 * El export NO acepta `limit`.
 *
 * Un volcado de auditoría recortado a las primeras N filas es justo el
 * documento que no sirve ante un auditor, y ofrecer el parámetro invita a
 * generarlo sin darse cuenta. Lo que acota el volumen es el rango de fechas.
 */
export const exportAuditTrailSchema = z
  .object({
    ...filters,
    format: z.enum(['csv', 'json']).default('csv'),
  })
  .strict();

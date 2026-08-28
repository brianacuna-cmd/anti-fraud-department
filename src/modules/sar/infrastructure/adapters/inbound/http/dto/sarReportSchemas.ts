import { z } from 'zod';

/**
 * POST /sar-reports body. Exactly one of `caseId`/`amlAlertId` is required
 * — the use case enforces the XOR (a zod `refine` here would duplicate that
 * domain rule and could drift from it).
 */
export const createSarReportSchema = z
  .object({
    caseId: z.string().min(1).nullable().optional(),
    amlAlertId: z.string().min(1).nullable().optional(),
    narrative: z.string().min(1),
    subjectName: z.string().min(1).nullable().optional(),
    suspiciousAmount: z.number().nonnegative().nullable().optional(),
    activityStartDate: z.string().datetime().nullable().optional(),
    activityEndDate: z.string().datetime().nullable().optional(),
  })
  .strict();

export type CreateSarReportBody = z.infer<typeof createSarReportSchema>;

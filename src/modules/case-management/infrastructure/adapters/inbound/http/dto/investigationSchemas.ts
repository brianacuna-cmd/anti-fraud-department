import { z } from 'zod';

/** POST /cases/:caseId/investigations body. */
export const openInvestigationSchema = z.object({
  subjectType: z.enum(['WALLET', 'EMAIL', 'CUSTOMER']),
  subjectId: z.string().trim().min(1),
});

export type OpenInvestigationBody = z.infer<typeof openInvestigationSchema>;

/** POST /cases/:caseId/investigations/:investigationId/close body. */
export const closeInvestigationSchema = z.object({
  findings: z.string().trim().min(1),
});

export type CloseInvestigationBody = z.infer<typeof closeInvestigationSchema>;

/** PATCH /investigations/:investigationId/findings body. */
export const updateInvestigationFindingsSchema = z.object({
  findings: z.record(z.string(), z.unknown()),
  explorationDepth: z.number().int().min(0),
});

export type UpdateInvestigationFindingsBody = z.infer<typeof updateInvestigationFindingsSchema>;

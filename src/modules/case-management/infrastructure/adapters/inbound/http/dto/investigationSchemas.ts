import { z } from 'zod';

/** POST /cases/:caseId/investigations body. */
export const openInvestigationSchema = z.object({
  subjectType: z.enum(['WALLET', 'EMAIL', 'CUSTOMER']),
  subjectId: z.string().trim().min(1),
});

export type OpenInvestigationBody = z.infer<typeof openInvestigationSchema>;

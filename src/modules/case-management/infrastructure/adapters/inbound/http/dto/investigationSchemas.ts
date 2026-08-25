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

/** POST /investigations/:investigationId/link-cases body. */
export const linkInvestigationCasesSchema = z.object({
  caseIds: z.array(z.string().min(1)).min(1).max(100),
});

export type LinkInvestigationCasesBody = z.infer<typeof linkInvestigationCasesSchema>;

/** PATCH /investigations/:investigationId/status body. */
export const updateInvestigationStatusSchema = z.object({
  status: z.enum(['INVESTIGATING', 'RESOLVED']),
});

export type UpdateInvestigationStatusBody = z.infer<typeof updateInvestigationStatusSchema>;

/**
 * GET /investigations/:investigationId/graph query (INV-013).
 *
 * `maxDepth` is capped here and not only in the use case because the cap is
 * a request defense: each round multiplies the frontier, and without the
 * limit at the edge anyone asks for depth 50 from the browser bar.
 */
export const entityNetworkGraphQuerySchema = z.object({
  maxDepth: z.coerce.number().int().min(1).max(5).optional(),
});

export type EntityNetworkGraphQuery = z.infer<typeof entityNetworkGraphQuerySchema>;

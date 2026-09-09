import { z } from 'zod';

/**
 * GET /notifications query (R3). Self-scoped inbox list — no
 * `organizationId`/`recipientUserId` here, those come exclusively from
 * `AuthContext` (mirrors `listCasesQuerySchema`'s tenant-from-auth pattern).
 */
export const listNotificationsQuerySchema = z.object({
  status: z.enum(['UNREAD']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

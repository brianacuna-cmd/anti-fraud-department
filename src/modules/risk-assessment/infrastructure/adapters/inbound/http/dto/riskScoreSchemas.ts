import { z } from 'zod';

/**
 * POST /risk-scores body. Domain/HTTP camelCase; `.strict()` rejects
 * snake_case extras such as `amount_cents`. `rawPayload` is accepted on
 * the wire but omitted from engine context and the scoring response.
 */
export const calculateRiskScoreSchema = z
  .object({
    provider: z.string().min(1),
    providerEventType: z.string().min(1),
    caseCustomerId: z.string().min(1),
    amountCents: z.number(),
    currency: z.string().min(1),
    riskSignals: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
    eventId: z.string().min(1).optional(),
    providerEventId: z.string().min(1).optional(),
    rail: z.string().min(1).optional(),
    rawPayload: z.record(z.string(), z.unknown()).optional(),
    subjectIdentity: z
      .object({
        nombre: z.string().optional(),
        documento: z.string().optional(),
        walletAddress: z.string().optional(),
        entryType: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CalculateRiskScoreBody = z.infer<typeof calculateRiskScoreSchema>;

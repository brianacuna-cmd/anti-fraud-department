import { z } from 'zod';
import {
  ACTIVITY_VARIABLES,
  CUSTOMER_HISTORY_VARIABLES,
} from '../../../../../domain/model/CustomerRiskContext.js';

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
        name: z.string().optional(),
        document: z.string().optional(),
        walletAddress: z.string().optional(),
        entryType: z.string().optional(),
      })
      .strict()
      .optional(),
    activity: z.partialRecord(z.enum(ACTIVITY_VARIABLES), z.number().finite()).optional(),
    customerHistory: z.partialRecord(z.enum(CUSTOMER_HISTORY_VARIABLES), z.number().finite()).optional(),
  })
  .strict();

export type CalculateRiskScoreBody = z.infer<typeof calculateRiskScoreSchema>;

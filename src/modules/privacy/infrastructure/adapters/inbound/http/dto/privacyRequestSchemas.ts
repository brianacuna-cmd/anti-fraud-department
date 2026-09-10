import { z } from 'zod';
import { PRIVACY_REQUEST_TYPES } from '../../../../../domain/model/value-objects/PrivacyRequestType.js';
import {
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_RESOLUTIONS,
} from '../../../../../domain/model/value-objects/PrivacyRequestStatus.js';

/**
 * POST /privacy-requests body.
 *
 * `subjectEmail` is only checked for shape here — the aggregate owns the real
 * rule. Deliberately NOT `z.string().email()`: zod rejects addresses that are
 * legal under RFC 5322, and bouncing a data-subject request over a quoted
 * local part would be a compliance failure dressed up as validation.
 */
export const ingestPrivacyRequestSchema = z
  .object({
    subjectEmail: z.string().min(3).max(320),
    subjectCustomerId: z.string().min(1).nullable().optional(),
    type: z.enum(PRIVACY_REQUEST_TYPES),
    requesterNote: z.string().max(4000).nullable().optional(),
  })
  .strict();

/** PATCH /privacy-requests/:id/resolve body. */
export const resolvePrivacyRequestSchema = z
  .object({
    resolution: z.enum(PRIVACY_RESOLUTIONS),
    // No `.optional()`: the aggregate refuses an empty motivation, and the
    // schema says so at the edge instead of letting it fail deeper in.
    note: z.string().min(1).max(4000),
  })
  .strict();

export const listPrivacyRequestsQuerySchema = z
  .object({
    status: z
      .union([z.enum(PRIVACY_REQUEST_STATUSES), z.array(z.enum(PRIVACY_REQUEST_STATUSES))])
      .optional(),
    type: z
      .union([z.enum(PRIVACY_REQUEST_TYPES), z.array(z.enum(PRIVACY_REQUEST_TYPES))])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

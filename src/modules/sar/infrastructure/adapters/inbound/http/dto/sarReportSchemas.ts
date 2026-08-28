import { z } from 'zod';

/** Shared address shape — the filer's and the subject's are the same thing. */
const postalAddressSchema = z
  .object({
    street: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1).nullable().optional(),
    postalCode: z.string().min(1),
    country: z.string().length(2),
  })
  .strict();

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
    subjectAddress: postalAddressSchema.nullable().optional(),
    subjectTin: z.string().min(1).nullable().optional(),
    subjectTinType: z.enum(['EIN', 'SSN_ITIN', 'FOREIGN', 'UNKNOWN']).nullable().optional(),
    subjectBirthDate: z.iso.datetime().nullable().optional(),
    suspiciousAmount: z.number().nonnegative().nullable().optional(),
    activityStartDate: z.iso.datetime().nullable().optional(),
    activityEndDate: z.iso.datetime().nullable().optional(),
    /*
     * Optional on a draft: a report is often opened before the activity is
     * classified. `SarFilingReadiness` is what refuses to build a file
     * without at least one.
     */
    activityCategories: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type CreateSarReportBody = z.infer<typeof createSarReportSchema>;

/**
 * PUT /sar-filing-profile body — who this organization is when it files.
 *
 * Every field is required because the profile is replaced whole: a partial
 * body would silently blank the fields it omits, and a filing identity that
 * is half old and half new is worse than either.
 */
export const upsertSarFilingProfileSchema = z
  .object({
    filerName: z.string().min(1),
    filerTin: z.string().min(1),
    filerTinType: z.enum(['EIN', 'SSN_ITIN', 'FOREIGN', 'UNKNOWN']),
    filerAddress: postalAddressSchema,
    contactName: z.string().min(1),
    contactPhone: z.string().min(1),
    contactEmail: z.email().nullable().optional(),
  })
  .strict();

export type UpsertSarFilingProfileBody = z.infer<typeof upsertSarFilingProfileSchema>;

/**
 * PATCH /sar-reports/:id/filing-status body — what the regulator answered.
 *
 * A discriminated union on `outcome`, not a bag of optional fields: an
 * acceptance without a tracking number and a rejection without a reason are
 * both meaningless, and `.strict()` on each branch makes sending the wrong
 * half a 400 instead of a silently half-filled record.
 */
export const recordSarFilingStatusSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('FILED'),
      bsaIdentifier: z.string().min(1),
      /** The date on the acknowledgement, not the day someone typed it in. */
      filedAt: z.iso.datetime(),
      acknowledgementReference: z.string().min(1).nullable().optional(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal('REJECTED'),
      reason: z.string().min(1),
    })
    .strict(),
]);

export type RecordSarFilingStatusBody = z.infer<typeof recordSarFilingStatusSchema>;

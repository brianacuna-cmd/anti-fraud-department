import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import { fromDate } from '../../../../../../shared/time/Instant.js';
import type { createCreateSarReportDraftUseCase } from '../../../../application/CreateSarReportDraft.js';
import type { createApproveSarReportDraftUseCase } from '../../../../application/ApproveSarReportDraft.js';
import {
  createSarReportSchema,
  recordSarFilingStatusSchema,
  upsertSarFilingProfileSchema,
} from './dto/sarReportSchemas.js';
import { toSarFilingProfileResponse, toSarReportResponse } from './mappers/SarReportHttpMapper.js';
import { renderFincenSarXml } from './report/FincenSarXmlRenderer.js';
import { createPostalAddress } from '../../../../domain/model/value-objects/PostalAddress.js';
import { createSuspiciousActivityCategory } from '../../../../domain/model/value-objects/SuspiciousActivityCategory.js';
import type { createGenerateSarReportXmlUseCase } from '../../../../application/GenerateSarReportXml.js';
import type { createRecordSarFilingStatusUseCase } from '../../../../application/RecordSarFilingStatus.js';
import type { createGetSarFilingProfileUseCase } from '../../../../application/GetSarFilingProfile.js';
import type { createUpsertSarFilingProfileUseCase } from '../../../../application/UpsertSarFilingProfile.js';
import { parseRequest } from './parseRequest.js';

export interface SarReportRouterDeps {
  readonly createSarReportDraft: ReturnType<typeof createCreateSarReportDraftUseCase>;
  readonly approveSarReportDraft: ReturnType<typeof createApproveSarReportDraftUseCase>;
  readonly generateSarReportXml: ReturnType<typeof createGenerateSarReportXmlUseCase>;
  readonly recordSarFilingStatus: ReturnType<typeof createRecordSarFilingStatusUseCase>;
  readonly getSarFilingProfile: ReturnType<typeof createGetSarFilingProfileUseCase>;
  readonly upsertSarFilingProfile: ReturnType<typeof createUpsertSarFilingProfileUseCase>;
}

/**
 * `/sar-reports` routes — SAR-001 only (draft create). Express 5 forwards
 * rejected handler promises to `errorHandler`.
 */
export function sarReportRouter(deps: SarReportRouterDeps): Router {
  const router = Router();

  router.post('/sar-reports', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createSarReportSchema, req.body);
    const report = await deps.createSarReportDraft({
      auth,
      caseId: body.caseId,
      amlAlertId: body.amlAlertId,
      narrative: body.narrative,
      subjectName: body.subjectName,
      suspiciousAmount: body.suspiciousAmount,
      subjectAddress: body.subjectAddress ? createPostalAddress(body.subjectAddress) : null,
      subjectTin: body.subjectTin,
      subjectTinType: body.subjectTinType,
      subjectBirthDate: body.subjectBirthDate ? fromDate(new Date(body.subjectBirthDate)) : null,
      activityStartDate: body.activityStartDate ? fromDate(new Date(body.activityStartDate)) : null,
      activityEndDate: body.activityEndDate ? fromDate(new Date(body.activityEndDate)) : null,
      activityCategories: (body.activityCategories ?? []).map(createSuspiciousActivityCategory),
    });
    res.status(201).json(toSarReportResponse(report));
  });

  router.patch('/sar-reports/:id/approve', async (req, res) => {
    const auth = requireAuthContext(req);
    const report = await deps.approveSarReportDraft({ auth, sarReportId: req.params.id! });
    res.status(200).json(toSarReportResponse(report));
  });

  /*
   * SAR-003. `GET` and not `POST` because it produces no side effect on the
   * report — it renders what is already locked. Sent as a downloadable file:
   * this is filed with a regulator, so it belongs on disk with a name, not
   * pretty-printed in a browser tab.
   */
  router.get('/sar-reports/:id/xml', async (req, res) => {
    const auth = requireAuthContext(req);
    const { report, profile } = await deps.generateSarReportXml({
      auth,
      sarReportId: req.params.id!,
    });
    const xml = renderFincenSarXml({ report, profile, generatedAt: new Date() });
    res.status(200);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sar-${report.id}.xml"`);
    res.send(xml);
  });

  /*
   * SAR-004. Records what came back from the regulator; it does not submit
   * anything — submission goes through FinCEN's E-Filing system, outside this
   * application, and what lands here is the receipt.
   */
  router.patch('/sar-reports/:id/filing-status', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(recordSarFilingStatusSchema, req.body);
    const report = await deps.recordSarFilingStatus({
      auth,
      sarReportId: req.params.id!,
      filing:
        body.outcome === 'FILED'
          ? {
              outcome: 'FILED',
              bsaIdentifier: body.bsaIdentifier,
              filedAt: fromDate(new Date(body.filedAt)),
              acknowledgementReference: body.acknowledgementReference ?? null,
            }
          : { outcome: 'REJECTED', reason: body.reason },
    });
    res.status(200).json(toSarReportResponse(report));
  });

  /*
   * The filing identity is per tenant, so it needs no id in the path — the
   * organization comes from the token, same shape as
   * `/organization-fraud-config`.
   */
  router.get('/sar-filing-profile', async (req, res) => {
    const auth = requireAuthContext(req);
    const profile = await deps.getSarFilingProfile({ auth });
    res.status(200).json(profile === null ? null : toSarFilingProfileResponse(profile));
  });

  router.put('/sar-filing-profile', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(upsertSarFilingProfileSchema, req.body);
    const profile = await deps.upsertSarFilingProfile({
      auth,
      filerName: body.filerName,
      filerTin: body.filerTin,
      filerTinType: body.filerTinType,
      filerAddress: createPostalAddress(body.filerAddress),
      contactName: body.contactName,
      contactPhone: body.contactPhone,
      contactEmail: body.contactEmail ?? null,
    });
    res.status(200).json(toSarFilingProfileResponse(profile));
  });

  return router;
}

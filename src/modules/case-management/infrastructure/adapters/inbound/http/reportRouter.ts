import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createGenerateCaseReportUseCase } from '../../../../application/GenerateCaseReport.js';
import type { createListCaseReportsUseCase } from '../../../../application/ListCaseReports.js';
import type { createGetCaseReportUseCase } from '../../../../application/GetCaseReport.js';
import { toCaseReportResponse } from './mappers/CaseReportHttpMapper.js';
import { CaseReportPdfRenderer } from './report/CaseReportPdfRenderer.js';
import { DossierZipPacker } from './report/DossierZipPacker.js';
import type { createGenerateCaseAuditDossierUseCase } from '../../../../application/GenerateCaseAuditDossier.js';

export interface ReportRouterDeps {
  readonly generateCaseReport: ReturnType<typeof createGenerateCaseReportUseCase>;
  readonly listCaseReports: ReturnType<typeof createListCaseReportsUseCase>;
  readonly getCaseReport: ReturnType<typeof createGetCaseReportUseCase>;
  readonly generateCaseAuditDossier: ReturnType<typeof createGenerateCaseAuditDossierUseCase>;
}

/**
 * Case report routes (separate router so `caseRouter` deps stay stable):
 * POST /cases/:caseId/reports (generate + persist), GET /cases/:caseId/reports
 * (list), GET /reports/:reportId (detail), GET /reports/:reportId/pdf (the
 * same snapshot as a downloadable document). Mounted on the authenticated
 * /api/v1 router.
 */
export function reportRouter(deps: ReportRouterDeps): Router {
  const router = Router();
  // Sin estado: una instancia para todo el router, como los renderizadores de
  // `caseExportRouter`.
  const pdf = new CaseReportPdfRenderer();
  const dossierPacker = new DossierZipPacker();

  router.post('/cases/:caseId/reports', async (req, res) => {
    const auth = requireAuthContext(req);
    const report = await deps.generateCaseReport({ auth, caseId: req.params.caseId! });
    res.status(201).json(toCaseReportResponse(report));
  });

  router.get('/cases/:caseId/reports', async (req, res) => {
    const auth = requireAuthContext(req);
    const reports = await deps.listCaseReports({ auth, caseId: req.params.caseId! });
    res.status(200).json({ items: reports.map(toCaseReportResponse) });
  });

  router.get('/reports/:reportId', async (req, res) => {
    const auth = requireAuthContext(req);
    const report = await deps.getCaseReport({ auth, reportId: req.params.reportId! });
    res.status(200).json(toCaseReportResponse(report));
  });

  /**
   * El informe como documento. Pasa por la MISMA guarda de inquilino que el
   * JSON (`getCaseReport`), asi que el PDF no es una puerta de atras a un
   * expediente de otra organizacion.
   *
   * `attachment` y no `inline`: un informe se archiva o se manda, y el nombre
   * del fichero lleva el id del expediente para que siga siendo identificable
   * fuera de la aplicacion.
   */
  router.get('/reports/:reportId/pdf', async (req, res) => {
    const auth = requireAuthContext(req);
    const report = await deps.getCaseReport({ auth, reportId: req.params.reportId! });
    const body = await pdf.render(report);

    res.setHeader('Content-Type', pdf.contentType);
    res.setHeader('Content-Length', String(body.length));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="informe-${report.caseId}-${report.id}.pdf"`,
    );
    res.status(200).send(body);
  });

  /**
   * INV-016. `X-Dossier-Missing-Evidence` avisa de las evidencias cuyo blob no
   * estaba en el almacen: el paquete se entrega igual —lo que hay sigue
   * sirviendo— pero quien lo recibe tiene que enterarse sin abrir el ZIP.
   */
  router.get('/cases/:caseId/dossier', async (req, res) => {
    const auth = requireAuthContext(req);
    const dossier = await deps.generateCaseAuditDossier({
      auth,
      caseId: req.params.caseId!,
      ...(typeof req.query.reportId === 'string' ? { reportId: req.query.reportId } : {}),
    });
    const body = await dossierPacker.pack(dossier);

    res.setHeader('Content-Type', dossierPacker.contentType);
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Content-Disposition', `attachment; filename="${dossierPacker.filenameFor(dossier)}"`);
    if (dossier.missingEvidenceIds.length > 0) {
      res.setHeader('X-Dossier-Missing-Evidence', dossier.missingEvidenceIds.join(','));
    }
    res.status(200).send(body);
  });

  return router;
}

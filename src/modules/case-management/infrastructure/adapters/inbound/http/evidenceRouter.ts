import { Router } from 'express';
import multer from 'multer';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import { invariantViolation } from '../../../../domain/errors/CaseManagementError.js';
import type { createRegisterEvidenceUseCase } from '../../../../application/RegisterEvidence.js';
import type { createListEvidenceUseCase } from '../../../../application/ListEvidence.js';
import type { createGetEvidenceUseCase } from '../../../../application/GetEvidence.js';
import type { createDownloadEvidenceUseCase } from '../../../../application/DownloadEvidence.js';
import type { createCreateEvidenceDownloadUrlUseCase } from '../../../../application/CreateEvidenceDownloadUrl.js';
import type { createDeleteEvidenceUseCase } from '../../../../application/DeleteEvidence.js';
import { toEvidenceResponse } from './mappers/EvidenceHttpMapper.js';

export interface EvidenceRouterDeps {
  readonly registerEvidence: ReturnType<typeof createRegisterEvidenceUseCase>;
  readonly listEvidence: ReturnType<typeof createListEvidenceUseCase>;
  readonly getEvidence: ReturnType<typeof createGetEvidenceUseCase>;
  readonly downloadEvidence: ReturnType<typeof createDownloadEvidenceUseCase>;
  readonly deleteEvidence: ReturnType<typeof createDeleteEvidenceUseCase>;
  /** Max upload size in bytes (default 25 MB). */
  readonly maxUploadBytes?: number;
  readonly createEvidenceDownloadUrl: ReturnType<typeof createCreateEvidenceDownloadUrlUseCase>;
}

/**
 * Evidence routes (separate router so `caseRouter` deps stay stable).
 * POST /cases/:caseId/evidence is multipart/form-data (field `file`) parsed by
 * multer in-memory — multipart bypasses the JSON body parser. GET routes list
 * metadata / fetch one / stream the blob. Mounted on the authenticated /api/v1.
 */
export function evidenceRouter(deps: EvidenceRouterDeps): Router {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxUploadBytes ?? 25 * 1024 * 1024 },
  });
  const router = Router();

  router.post('/cases/:caseId/evidence', upload.single('file'), async (req, res) => {
    const auth = requireAuthContext(req);
    const file = req.file;
    if (file === undefined) {
      throw invariantViolation('a multipart file field "file" is required');
    }
    const investigationId = singleQueryValue(req.query.investigationId);
    const evidence = await deps.registerEvidence({
      auth,
      caseId: req.params.caseId as string,
      investigationId,
      filename: file.originalname,
      contentType: file.mimetype,
      bytes: file.buffer,
    });
    res.status(201).json(toEvidenceResponse(evidence));
  });

  router.get('/cases/:caseId/evidence', async (req, res) => {
    const auth = requireAuthContext(req);
    const items = await deps.listEvidence({ auth, caseId: req.params.caseId! });
    res.status(200).json({ items: items.map(toEvidenceResponse) });
  });

  router.get('/evidence/:evidenceId', async (req, res) => {
    const auth = requireAuthContext(req);
    const evidence = await deps.getEvidence({ auth, evidenceId: req.params.evidenceId! });
    res.status(200).json(toEvidenceResponse(evidence));
  });

  /**
   * INV-004. Antes que `/download`: son rutas hermanas y el orden importa poco
   * aqui, pero mantenerlas juntas evita que alguien meta un patron con
   * comodin en medio.
   *
   * Devuelve una URL, no el fichero: la descarga va directa contra el almacen
   * de objetos y no atraviesa este proceso. Falla explicitamente si el almacen
   * configurado no sabe firmar (filesystem en desarrollo), en cuyo caso la
   * ruta de streaming de abajo es la que sirve.
   */
  router.get('/evidence/:evidenceId/download-url', async (req, res) => {
    const auth = requireAuthContext(req);
    const result = await deps.createEvidenceDownloadUrl({
      auth,
      evidenceId: req.params.evidenceId!,
    });
    res.status(200).json({
      url: result.url,
      expiresAt: result.expiresAt,
      filename: result.evidence.filename,
      contentType: result.evidence.contentType,
      sha256: result.evidence.sha256,
    });
  });

  router.get('/evidence/:evidenceId/download', async (req, res) => {
    const auth = requireAuthContext(req);
    const { evidence, bytes } = await deps.downloadEvidence({ auth, evidenceId: req.params.evidenceId! });
    res.setHeader('Content-Type', evidence.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(evidence.filename)}"`);
    res.status(200).send(bytes);
  });

  router.delete('/evidence/:evidenceId', async (req, res) => {
    const auth = requireAuthContext(req);
    const evidence = await deps.deleteEvidence({ auth, evidenceId: req.params.evidenceId! });
    res.status(200).json(toEvidenceResponse(evidence));
  });

  return router;
}

function singleQueryValue(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

/** Strips quotes/newlines so the value is safe inside the Content-Disposition header. */
function sanitizeFilename(filename: string): string {
  return filename.replace(/["\r\n]/g, '_');
}

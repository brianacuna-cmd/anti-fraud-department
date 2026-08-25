import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import { invariantViolation } from '../../../../domain/errors/ScreeningError.js';
import type { createSubmitBulkScreeningJobUseCase } from '../../../../application/SubmitBulkScreeningJob.js';
import type { createGetBulkScreeningJobUseCase } from '../../../../application/GetBulkScreeningJob.js';
import { toSubmitBulkScreeningJobResponse, toBulkScreeningJobResponse } from './mappers/BulkScreeningHttpMapper.js';

const ALLOWED_MIMETYPES = new Set(['text/csv', 'application/csv', 'text/plain']);

function isCsvFile(file: Express.Multer.File): boolean {
  if (ALLOWED_MIMETYPES.has(file.mimetype)) return true;
  return file.originalname.toLowerCase().endsWith('.csv');
}

export interface BulkScreeningRouterDeps {
  readonly submitBulkScreeningJob: ReturnType<typeof createSubmitBulkScreeningJobUseCase>;
  readonly getBulkScreeningJob: ReturnType<typeof createGetBulkScreeningJobUseCase>;
  /** Temp directory for uploaded CSVs. Defaults to `$BULK_SCREENING_TEMP_DIR` or `os.tmpdir()/bulk-screening`. */
  readonly tempDir?: string;
  /** Max upload size in bytes (default 5 MiB). */
  readonly maxUploadBytes?: number;
}

/**
 * `/bulk-screening-jobs` routes: multipart CSV upload (POST) and progress poll
 * (GET). Mirrors `evidenceRouter` for multer setup and `watchlistRouter` for
 * use-case wiring (design D2, D8, D9, RF-BS-1, RF-BS-2).
 */
export function bulkScreeningRouter(deps: BulkScreeningRouterDeps): Router {
  const tempDir =
    deps.tempDir ??
    process.env['BULK_SCREENING_TEMP_DIR'] ??
    path.join(os.tmpdir(), 'bulk-screening');

  fs.mkdirSync(tempDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, tempDir),
      filename: (_req, _file, cb) => {
        // Never interpolate originalname — path.join would honour `..` segments.
        cb(null, `${Date.now()}-${randomBytes(8).toString('hex')}.csv`);
      },
    }),
    limits: { fileSize: deps.maxUploadBytes ?? 5_242_880 },
  });

  const router = Router();

  router.post('/bulk-screening-jobs', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Uploaded file exceeds the 5 MiB size limit', metadata: {} },
        });
        return;
      }
      if (err) {
        next(err);
        return;
      }
      next();
    });
  }, async (req, res) => {
    try {
      const auth = requireAuthContext(req);
      const file = req.file;

      if (file === undefined) {
        throw invariantViolation('a multipart file field "file" is required');
      }

      if (!isCsvFile(file)) {
        throw invariantViolation(
          'uploaded file must be a CSV (text/csv, application/csv, text/plain, or .csv extension)',
          { mimetype: file.mimetype, originalname: file.originalname },
        );
      }

      const jobId = await deps.submitBulkScreeningJob({ auth, filePath: file.path });
      res.status(202).json(toSubmitBulkScreeningJobResponse(jobId));
    } catch (err) {
      if (req.file?.path) {
        await fs.promises.unlink(req.file.path).catch(() => undefined);
      }
      throw err;
    }
  });

  router.get('/bulk-screening-jobs/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const view = await deps.getBulkScreeningJob({ auth, jobId: req.params.id! });
    res.status(200).json(toBulkScreeningJobResponse(view));
  });

  return router;
}

import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import { invariantViolation } from '../../../../domain/errors/RiskAssessmentError.js';
import {
  PAYMENT_ACTIVITY_CSV_COLUMNS,
  type createImportPaymentActivitiesUseCase,
  type PaymentActivityCsvRow,
} from '../../../../application/ImportPaymentActivities.js';

export interface PaymentActivityImportRouterDeps {
  readonly importPaymentActivities: ReturnType<typeof createImportPaymentActivitiesUseCase>;
  /** Max upload size in bytes (default 10 MiB, comfortably above 20 000 rows). */
  readonly maxUploadBytes?: number;
}

const REQUIRED_COLUMNS = PAYMENT_ACTIVITY_CSV_COLUMNS.slice(0, 6);

/**
 * `POST /payment-activities/import`: multipart CSV (`file`) into the customer
 * payment history. Synchronous — the file is bounded by size and row count —
 * so the analyst gets the per-row report in the same response.
 *
 * Kept in memory, not on disk: nothing else needs the file afterwards, and a
 * temp file would be one more thing to clean up on every error path.
 */
export function paymentActivityImportRouter(deps: PaymentActivityImportRouterDeps): Router {
  const maxBytes = deps.maxUploadBytes ?? 10 * 1024 * 1024;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes } });
  const router = Router();

  router.post(
    '/payment-activities/import',
    (req, res, next) => {
      upload.single('file')(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({
            error: { code: 'PAYLOAD_TOO_LARGE', message: `the file exceeds ${maxBytes} bytes`, metadata: {} },
          });
          return;
        }
        next(err);
      });
    },
    async (req, res) => {
      const auth = requireAuthContext(req);
      const file = req.file;
      if (file === undefined) {
        throw invariantViolation('a multipart file field "file" is required');
      }

      const rows = parseCsv(file.buffer);
      const result = await deps.importPaymentActivities({ auth, rows, fileName: file.originalname });
      res.status(200).json(result);
    },
  );

  return router;
}

function parseCsv(buffer: Buffer): PaymentActivityCsvRow[] {
  let header: string[] = [];
  let rows: PaymentActivityCsvRow[];
  try {
    rows = parse(buffer, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      columns: (names: string[]) => {
        header = names.map((name) => name.trim().toLowerCase());
        return header;
      },
    }) as PaymentActivityCsvRow[];
  } catch (error) {
    throw invariantViolation(`the file is not a readable CSV: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertHeader(header);
  return rows;
}

function assertHeader(header: readonly string[]): void {
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw invariantViolation(`the CSV header is missing required columns: ${missing.join(', ')}`, {
      required: [...REQUIRED_COLUMNS],
      found: [...header],
    });
  }
}

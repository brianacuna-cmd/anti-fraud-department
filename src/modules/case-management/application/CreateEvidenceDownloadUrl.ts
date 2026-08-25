import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { Evidence } from '../domain/model/aggregates/Evidence.js';
import type { EvidenceRepository } from '../domain/ports/EvidenceRepository.js';
import type { EvidenceStore } from '../domain/ports/EvidenceStore.js';
import { createEvidenceId } from '../domain/model/value-objects/EvidenceId.js';
import { fromDate, toDate } from '../../../shared/time/Instant.js';
import {
  evidenceNotFound,
  forbiddenCrossTenant,
  invariantViolation,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

/**
 * URL expiry. Five minutes: enough for the browser to start the download and
 * short enough that the URL does not survive in a history, a proxy log, or a
 * chat. The presigned URL is a bearer grant — whoever has it takes the
 * evidence, without going through the session — and its window is the only
 * protection there is.
 */
export const EVIDENCE_URL_TTL_SECONDS = 300;

export interface CreateEvidenceDownloadUrlInput {
  readonly auth: AuthContext;
  readonly evidenceId: string;
}

export interface CreateEvidenceDownloadUrlResult {
  readonly evidence: Evidence;
  readonly url: string;
  readonly expiresAt: Instant;
}

export interface CreateEvidenceDownloadUrlDeps {
  readonly evidence: EvidenceRepository;
  readonly evidenceStore: EvidenceStore;
  readonly clock: Clock;
}

/**
 * INV-004 — secure download via a temporary presigned URL.
 *
 * GET /evidence/:evidenceId/download-url
 *
 * The file does not pass through the API: evidence can be a dump of hundreds
 * of megabytes and pushing it through the Node process blocks it for the
 * duration. Tenant and soft-delete gates are applied BEFORE signing, which
 * is the only moment they can be applied: once issued, the URL no longer
 * comes through here.
 *
 * If the configured store cannot sign —the filesystem one, in development—
 * this fails explicitly instead of inventing a URL. The streaming route
 * `GET /evidence/:evidenceId/download` still exists and is what serves in
 * that environment.
 */
export function createCreateEvidenceDownloadUrlUseCase(deps: CreateEvidenceDownloadUrlDeps) {
  return async function createEvidenceDownloadUrl(
    input: CreateEvidenceDownloadUrlInput,
  ): Promise<CreateEvidenceDownloadUrlResult> {
    const organizationId = requireTenantContext(input.auth);
    const evidenceId = createEvidenceId(input.evidenceId);

    const evidence = await deps.evidence.findById(evidenceId);
    if (evidence === null || evidence.deletedAt !== null) {
      throw evidenceNotFound(evidenceId);
    }
    if (evidence.organizationId !== organizationId) {
      throw forbiddenCrossTenant('evidence does not belong to the actor organization');
    }

    const presign = deps.evidenceStore.presignDownload;
    if (presign === undefined) {
      throw invariantViolation(
        'the configured evidence store cannot issue presigned URLs; use the streaming download route',
        { evidenceId },
      );
    }

    const url = await presign.call(deps.evidenceStore, evidence.storageKey, EVIDENCE_URL_TTL_SECONDS);
    const expiresAt = fromDate(
      new Date(toDate(deps.clock.now()).getTime() + EVIDENCE_URL_TTL_SECONDS * 1000),
    );
    return { evidence, url, expiresAt };
  };
}

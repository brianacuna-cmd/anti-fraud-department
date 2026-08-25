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
 * Caducidad de la URL. Cinco minutos: basta para que el navegador arranque la
 * descarga y es poco para que la URL sobreviva en un historial, un log de
 * proxy o un chat. La URL prefirmada es un permiso al portador — quien la
 * tenga se lleva la evidencia, sin pasar por la sesión— y su ventana es toda
 * la protección que hay.
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
 * INV-004 — descarga segura por URL prefirmada temporal.
 *
 * GET /evidence/:evidenceId/download-url
 *
 * El fichero no atraviesa la API: una evidencia puede ser un volcado de
 * cientos de megas y hacerla pasar por el proceso Node lo bloquea mientras
 * dura. Las guardas de inquilino y borrado lógico se aplican ANTES de firmar,
 * que es el único momento en que se pueden aplicar: una vez emitida, la URL
 * ya no pasa por aquí.
 *
 * Si el almacén configurado no sabe firmar —el de filesystem, en desarrollo—
 * esto falla explícitamente en vez de inventarse una URL. La ruta de streaming
 * `GET /evidence/:evidenceId/download` sigue existiendo y es la que sirve en
 * ese entorno.
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

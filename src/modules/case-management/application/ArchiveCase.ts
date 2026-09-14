import { closeCase, type CloseCaseDeps } from './closeCase.js';

export type ArchiveCaseDeps = CloseCaseDeps;

/** Archives a resolved case (RESOLVED -> ARCHIVED). SUPERVISOR only. See `closeCase`. */
export function createArchiveCaseUseCase(deps: ArchiveCaseDeps) {
  return closeCase(deps, { closureType: 'ARCHIVED', auditAction: 'ARCHIVE_CASE' });
}

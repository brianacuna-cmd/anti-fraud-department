import { closeCase, type CloseCaseDeps, type CloseCaseInput } from './closeCase.js';

export type ArchiveCaseInput = CloseCaseInput;
export type ArchiveCaseDeps = CloseCaseDeps;

/** Archives a resolved case (RESOLVED -> ARCHIVED). SUPERVISOR|ADMIN only. See `closeCase`. */
export function createArchiveCaseUseCase(deps: ArchiveCaseDeps) {
  return closeCase(deps, { closureType: 'ARCHIVED', auditAction: 'ARCHIVE_CASE' });
}

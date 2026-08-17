import { closeCase, type CloseCaseDeps, type CloseCaseInput } from './closeCase.js';

export type ResolveCaseInput = CloseCaseInput;
export type ResolveCaseDeps = CloseCaseDeps;

/** Resolves a case (OPEN|IN_REVIEW -> RESOLVED). SUPERVISOR|ADMIN only. See `closeCase`. */
export function createResolveCaseUseCase(deps: ResolveCaseDeps) {
  return closeCase(deps, 'RESOLVED', 'RESOLVE_CASE');
}

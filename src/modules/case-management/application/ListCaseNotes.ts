import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseNote } from '../domain/model/aggregates/CaseNote.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { CaseNoteRepository } from '../domain/ports/CaseNoteRepository.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListCaseNotesInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface ListCaseNotesDeps {
  readonly cases: CaseRepository;
  readonly notes: CaseNoteRepository;
}

/** Lists a case's notes oldest-first, behind the same tenant + soft-delete gates as `GetCase`. */
export function createListCaseNotesUseCase(deps: ListCaseNotesDeps) {
  return async function listCaseNotes(input: ListCaseNotesInput): Promise<CaseNote[]> {
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    const kase = await deps.cases.findById(caseId);
    if (kase === null || kase.deletedAt !== null) {
      throw caseNotFound(caseId);
    }
    if (kase.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }
    return deps.notes.listByCaseId(caseId);
  };
}

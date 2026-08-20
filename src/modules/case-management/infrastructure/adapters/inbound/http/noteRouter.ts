import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createDeleteCaseNoteUseCase } from '../../../../application/DeleteCaseNote.js';
import { toCaseNoteResponse } from './mappers/CaseNoteHttpMapper.js';

export interface NoteRouterDeps {
  readonly deleteCaseNote: ReturnType<typeof createDeleteCaseNoteUseCase>;
}

/**
 * Note routes that are not case-scoped (separate router so the busy
 * `caseRouter` deps stay stable, mirroring `evidenceRouter`).
 * DELETE /notes/:noteId is a role-gated logical (soft) delete. Mounted on the
 * same authenticated /api/v1 router as `caseRouter`.
 */
export function noteRouter(deps: NoteRouterDeps): Router {
  const router = Router();

  router.delete('/notes/:noteId', async (req, res) => {
    const auth = requireAuthContext(req);
    const note = await deps.deleteCaseNote({ auth, noteId: req.params.noteId! });
    res.status(200).json(toCaseNoteResponse(note));
  });

  return router;
}

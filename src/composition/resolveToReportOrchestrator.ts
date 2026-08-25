import type { createGenerateCaseReportUseCase } from '../modules/case-management/application/GenerateCaseReport.js';
import type { createResolveCaseUseCase } from '../modules/case-management/application/ResolveCase.js';

export interface ResolveToReportDeps {
  readonly resolveCase: ReturnType<typeof createResolveCaseUseCase>;
  readonly generateCaseReport: ReturnType<typeof createGenerateCaseReportUseCase>;
  readonly onReportError?: (error: unknown, caseId: string) => void;
}

/**
 * On resolving a case, freeze its report.
 *
 * WHY AUTOMATIC
 *
 * The report is the immutable snapshot of the closed case, and the moment
 * it makes sense to take it is exactly at close. Leaving it as a separate
 * button produced resolved cases with no report — the most useless state of
 * all: the case is no longer worked, nobody will go back in, and the day
 * the dossier is needed there is nothing to pack.
 *
 * WHY HERE AND NOT INSIDE `closeCase`
 *
 * `GenerateCaseReport` needs fourteen repositories: timeline, notes,
 * investigations, resolutions, enforcement, decisions, evidence, signature
 * requests, SLA, and directory. Stuffing all of that into `closeCase` would
 * turn it into a use case that depends on half the module just to make a
 * state transition. Composition-root orchestrators exist for exactly this —
 * same as `scoreToCaseOrchestrator` joins scoring and cases without either
 * module knowing the other.
 *
 * WHY FAILURE DOES NOT KILL THE CLOSE
 *
 * The report is generated AFTER the resolution has confirmed. If it fails
 * — a downed repository, unexpected data — the case stays closed anyway
 * and the report can be requested by hand from the case page. The
 * alternative is worse: a problem composing a PDF blocking close of a
 * fraud case.
 *
 * The trade-off is that a resolved case can be left without a report. It
 * is visible: the step guide marks it pending and offers to generate it.
 */
export function createResolveToReportOrchestrator(deps: ResolveToReportDeps) {
  const onError = deps.onReportError ?? defaultOnError;

  return async function resolveCaseAndFreezeReport(
    input: Parameters<ResolveToReportDeps['resolveCase']>[0],
  ): ReturnType<ResolveToReportDeps['resolveCase']> {
    const kase = await deps.resolveCase(input);

    try {
      await deps.generateCaseReport({ auth: input.auth, caseId: kase.id });
    } catch (error) {
      onError(error, kase.id);
    }

    return kase;
  };
}

function defaultOnError(error: unknown, caseId: string): void {
  console.error(
    `[resolveToReport] el expediente ${caseId} se cerró pero su informe no se pudo congelar; ` +
      'se puede generar a mano desde la ficha',
    error,
  );
}

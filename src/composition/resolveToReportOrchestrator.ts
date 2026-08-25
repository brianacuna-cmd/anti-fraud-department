import type { createGenerateCaseReportUseCase } from '../modules/case-management/application/GenerateCaseReport.js';
import type { createResolveCaseUseCase } from '../modules/case-management/application/ResolveCase.js';

export interface ResolveToReportDeps {
  readonly resolveCase: ReturnType<typeof createResolveCaseUseCase>;
  readonly generateCaseReport: ReturnType<typeof createGenerateCaseReportUseCase>;
  readonly onReportError?: (error: unknown, caseId: string) => void;
}

/**
 * Al resolver un expediente, congela su informe.
 *
 * POR QUÉ AUTOMÁTICO
 *
 * El informe es la foto inmutable del expediente cerrado, y el momento en que
 * tiene sentido tomarla es exactamente el del cierre. Dejarlo como un botón
 * aparte producía expedientes resueltos sin informe —el estado más inútil de
 * todos: el caso ya no se trabaja, nadie va a volver a entrar, y el día que
 * haga falta el dossier resulta que no hay nada que empaquetar—.
 *
 * POR QUÉ AQUÍ Y NO DENTRO DE `closeCase`
 *
 * `GenerateCaseReport` necesita catorce repositorios: cronología, notas,
 * investigaciones, resoluciones, sanciones, dictámenes, evidencia, solicitudes
 * de firma, SLA y directorio. Meter todo eso en `closeCase` lo convertiría en
 * un caso de uso que depende de medio módulo para hacer una transición de
 * estado. Los orquestadores del raíz de composición existen justamente para
 * esto — igual que `scoreToCaseOrchestrator` une puntuación y expedientes sin
 * que ninguno de los dos módulos conozca al otro.
 *
 * POR QUÉ EL FALLO NO TUMBA EL CIERRE
 *
 * El informe se genera DESPUÉS de que la resolución haya confirmado. Si falla
 * —un repositorio caído, un dato inesperado— el expediente queda cerrado
 * igualmente y el informe se puede pedir a mano desde la ficha. La alternativa
 * es peor: que un problema al componer un PDF impida cerrar un caso de fraude.
 *
 * La contrapartida es que puede quedar un expediente resuelto sin informe. Es
 * visible: la guía de pasos lo marca como pendiente y ofrece generarlo.
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

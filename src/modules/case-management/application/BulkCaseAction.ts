import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { createAssignCaseUseCase } from './AssignCase.js';
import type { createReclassifyCaseUseCase } from './ReclassifyCase.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { CaseManagementError, invariantViolation } from '../domain/errors/CaseManagementError.js';

export const BULK_ACTIONS = ['REASSIGN', 'SET_PRIORITY', 'ADD_TAGS', 'REMOVE_TAGS'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/**
 * Tope por peticion. Un lote sin limite mantiene abierta una peticion HTTP
 * durante minutos y deja al analista sin saber si sigue viva; ademas convierte
 * un clic accidental en "seleccionar todo" en una escritura masiva.
 */
export const MAX_BULK_CASES = 500;

export interface BulkCaseActionInput {
  readonly auth: AuthContext;
  readonly caseIds: readonly string[];
  readonly action: BulkAction;
  readonly assignedTo?: { readonly type: string; readonly id: string } | null;
  readonly priority?: string;
  readonly tags?: readonly string[];
}

export interface BulkCaseActionOutcome {
  readonly caseId: string;
  readonly ok: boolean;
  /** Codigo de error del dominio cuando `ok` es falso. */
  readonly errorCode?: string;
  readonly message?: string;
}

export interface BulkCaseActionResult {
  readonly succeeded: number;
  readonly failed: number;
  readonly outcomes: readonly BulkCaseActionOutcome[];
}

export interface BulkCaseActionDeps {
  readonly cases: CaseRepository;
  readonly assignCase: ReturnType<typeof createAssignCaseUseCase>;
  readonly reclassifyCase: ReturnType<typeof createReclassifyCaseUseCase>;
}

/**
 * CASE-012 — acciones por lote sobre varios expedientes.
 *
 * Delega en `AssignCase` y `ReclassifyCase` en lugar de reimplementar sus
 * reglas. Es la decision que sostiene todo lo demas: si el lote escribiera por
 * su cuenta, tendria que duplicar la comprobacion de inquilino, la validacion
 * del destinatario, el recalculo de SLA y los asientos de auditoria — y en
 * cuanto una de esas reglas cambiase, la via masiva se quedaria atras
 * silenciosamente. Asi, un lote hace exactamente lo mismo que N acciones
 * sueltas, por construccion.
 *
 * Cada caso se procesa de forma independiente y con su propia transaccion.
 * NO es todo-o-nada: un analista que selecciona cincuenta expedientes no debe
 * perder cuarenta y nueve aciertos porque uno estuviera archivado o ya no
 * exista. El resultado detalla que paso con cada uno, para que la interfaz
 * pueda decirlo en lugar de mostrar un exito o un fallo global que miente.
 */
export function createBulkCaseActionUseCase(deps: BulkCaseActionDeps) {
  return async function bulkCaseAction(input: BulkCaseActionInput): Promise<BulkCaseActionResult> {
    const ids = [...new Set(input.caseIds.map((id) => id?.trim()).filter(Boolean))] as string[];

    if (ids.length === 0) {
      throw invariantViolation('Debe indicarse al menos un caso', { caseIds: input.caseIds });
    }
    if (ids.length > MAX_BULK_CASES) {
      throw invariantViolation(`Un lote no puede superar ${MAX_BULK_CASES} casos`, {
        requested: ids.length,
        max: MAX_BULK_CASES,
      });
    }

    const outcomes: BulkCaseActionOutcome[] = [];

    for (const caseId of ids) {
      try {
        await applyOne(deps, input, caseId);
        outcomes.push({ caseId, ok: true });
      } catch (error) {
        // Un fallo individual no aborta el lote, pero tampoco se traga: se
        // devuelve identificado para que la interfaz pueda listarlo.
        const code = error instanceof CaseManagementError ? error.code : 'UNKNOWN';
        outcomes.push({
          caseId,
          ok: false,
          errorCode: String(code),
          message: (error as Error).message,
        });
      }
    }

    return {
      succeeded: outcomes.filter((o) => o.ok).length,
      failed: outcomes.filter((o) => !o.ok).length,
      outcomes,
    };
  };
}

async function applyOne(
  deps: BulkCaseActionDeps,
  input: BulkCaseActionInput,
  caseId: string,
): Promise<void> {
  switch (input.action) {
    case 'REASSIGN':
      await deps.assignCase({ auth: input.auth, caseId, assignedTo: input.assignedTo ?? null });
      return;

    case 'SET_PRIORITY':
      if (!input.priority) {
        throw invariantViolation('SET_PRIORITY requiere priority', {});
      }
      await deps.reclassifyCase({ auth: input.auth, caseId, priority: input.priority });
      return;

    case 'ADD_TAGS':
    case 'REMOVE_TAGS': {
      if (!input.tags || input.tags.length === 0) {
        throw invariantViolation(`${input.action} requiere tags`, {});
      }

      // `ReclassifyCase` recibe el conjunto completo de etiquetas, no un delta,
      // asi que anadir o quitar exige leer las actuales y componer el resultado.
      const kase = await deps.cases.findById(createCaseId(caseId));
      if (!kase) {
        throw invariantViolation('El caso no existe', { caseId });
      }

      const requested = input.tags.map((tag) => tag.trim()).filter(Boolean);
      const nextTags =
        input.action === 'ADD_TAGS'
          ? [...kase.tags, ...requested]
          : kase.tags.filter((tag) => !requested.includes(tag));

      // La deduplicacion la hace el agregado en `reclassify`; aqui basta con
      // pasarle la union.
      await deps.reclassifyCase({ auth: input.auth, caseId, tags: nextTags });
      return;
    }
  }
}

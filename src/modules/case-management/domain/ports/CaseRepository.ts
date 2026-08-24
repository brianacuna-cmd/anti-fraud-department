import type { Case } from '../model/aggregates/Case.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { CaseStatus } from '../model/value-objects/CaseStatus.js';
import type { CasePriority } from '../model/value-objects/CasePriority.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import type { EntityRef } from '../model/value-objects/EntityNodeType.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Inbox list query (PR3). Always scoped to one organization; soft-deleted
 * cases are excluded by every adapter. Default sort is dueDate ASC with
 * nulls last.
 */
export interface CaseListQuery {
  readonly organizationId: string;
  readonly status?: readonly CaseStatus[];
  readonly priority?: readonly CasePriority[];
  readonly assignedToId?: string;
  readonly riskScoreMin?: number;
  readonly riskScoreMax?: number;
  readonly tags?: readonly string[];
  readonly dueAfter?: Instant;
  readonly dueBefore?: Instant;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Identidad con la que la ingesta de Finturu busca un expediente ya existente
 * antes de abrir uno nuevo (CASE-011). `customerId` y `bridgeUserId` componen
 * como OR; `statuses`, cuando se pasa, acota la ventana de ciclo de vida.
 *
 * `IngestFinturuCase` pasa la ventana ACTIVA (spec CASE-011: "si la entidad ya
 * tiene un caso OPEN o IN_REVIEW"), mientras que `OpenFraudCaseFromCustomer` la
 * omite porque reabrir un caso RESOLVED/ARCHIVED es su camino previsto.
 */
export interface FindCaseByIdentityOptions {
  readonly organizationId: string;
  readonly customerId?: string | null;
  readonly bridgeUserId?: string | null;
  readonly statuses?: readonly CaseStatus[];
}

/** La ventana de ciclo de vida que CASE-011 trata como "ya tiene expediente abierto". */
export const ACTIVE_CASE_STATUSES: readonly CaseStatus[] = ['OPEN', 'IN_REVIEW'];

export interface CaseListResult {
  readonly items: readonly Case[];
  readonly total: number;
}

/**
 * Expansión del grafo de entidades (INV-013): los expedientes de ESTA
 * organización que citan cualquiera de `refs`.
 *
 * Los `refs` componen como OR —basta compartir un identificador para estar en
 * la red— y `limit` acota cada ronda, porque un identificador muy compartido
 * (un email de dominio corporativo, una wallet de exchange) puede arrastrar
 * miles de expedientes y la ronda siguiente los multiplicaría.
 */
export interface EntityIdentifierQuery {
  readonly organizationId: string;
  readonly refs: readonly EntityRef[];
  readonly limit: number;
}

/** Outbound port for the `Case` aggregate (save/findById + inbox `list`). */
export interface CaseRepository {
  save(kase: Case, tx?: Transaction): Promise<void>;
  findById(id: CaseId, tx?: Transaction): Promise<Case | null>;
  /**
   * Idempotency lookup (RF-3/RF-5): org-scoped, matches ONLY a present
   * non-null `idempotencyKey` — mirrors the Mongo unique partial index's
   * null-exclusion semantics.
   */
  findByIdempotencyKey(organizationId: string, idempotencyKey: string, tx?: Transaction): Promise<Case | null>;
  list(query: CaseListQuery, tx?: Transaction): Promise<CaseListResult>;
  /**
   * Deduplicacion de la ingesta de Finturu (CASE-011): devuelve el expediente
   * de ESTA organizacion que ya cubre la identidad recibida, o `null`. Nunca
   * cruza inquilinos ni devuelve expedientes borrados.
   */
  findByCustomerOrBridgeId(options: FindCaseByIdentityOptions, tx?: Transaction): Promise<Case | null>;
  /**
   * Expansion del grafo de entidades (INV-013). Devuelve los expedientes de la
   * organizacion que citan cualquiera de los identificadores pedidos, sin
   * borrados logicos y sin cruzar inquilinos.
   */
  findByEntityIdentifiers(query: EntityIdentifierQuery, tx?: Transaction): Promise<readonly Case[]>;
}

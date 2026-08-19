import type { Instant } from '../../../../../shared/time/Instant.js';
import type { CaseRoutingRuleId } from '../value-objects/CaseRoutingRuleId.js';
import type { CasePriority } from '../value-objects/CasePriority.js';
import type { AssignedTo } from '../value-objects/AssignedTo.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type RoutingRuleStatus = 'ACTIVE' | 'INACTIVE';

/**
 * Condiciones de una regla. Todas las declaradas deben cumplirse a la vez
 * (conjuncion); las omitidas no restringen nada.
 *
 * Es un conjunto CERRADO de criterios, no un lenguaje de expresiones. Una
 * regla de enrutamiento decide a quien llega un expediente de fraude, asi que
 * tiene que poder auditarse leyendola: un campo de texto con una expresion
 * arbitraria seria imposible de revisar y una via directa para ejecutar codigo
 * de configuracion en el motor.
 */
export interface RoutingConditions {
  readonly riskScoreMin?: number;
  readonly riskScoreMax?: number;
  readonly priorities?: readonly CasePriority[];
  /** El caso debe llevar TODAS estas etiquetas. */
  readonly tags?: readonly string[];
  /** Dominio del email del cliente, sin arroba y sin distinguir mayusculas. */
  readonly customerEmailDomain?: string;
  readonly hasStripeCustomer?: boolean;
  readonly hasBridgeWallet?: boolean;
}

export interface CaseRoutingRuleProps {
  readonly id: CaseRoutingRuleId;
  readonly organizationId: string;
  readonly name: string;
  /**
   * Orden de evaluacion, menor primero. Gana la PRIMERA regla que encaja, asi
   * que este numero es la unica forma de expresar "esta excepcion manda sobre
   * la regla general".
   */
  readonly evaluationOrder: number;
  readonly conditions: RoutingConditions;
  readonly assignTo: AssignedTo;
  readonly status: RoutingRuleStatus;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateCaseRoutingRuleInput {
  readonly id: CaseRoutingRuleId;
  readonly organizationId: string;
  readonly name: string;
  readonly evaluationOrder: number;
  readonly conditions: RoutingConditions;
  readonly assignTo: AssignedTo;
  readonly status?: RoutingRuleStatus;
  readonly now: Instant;
}

/**
 * CASE-002 — regla de enrutamiento automatico de un inquilino.
 *
 * Inmutable como el resto de agregados del modulo: cada cambio devuelve una
 * instancia nueva.
 */
export class CaseRoutingRule {
  private constructor(private readonly props: CaseRoutingRuleProps) {}

  static create(input: CreateCaseRoutingRuleInput): CaseRoutingRule {
    if (input.name.trim().length === 0) {
      throw invariantViolation('CaseRoutingRule name must be a non-empty string', { name: input.name });
    }
    if (!Number.isInteger(input.evaluationOrder) || input.evaluationOrder < 0) {
      throw invariantViolation('CaseRoutingRule evaluationOrder must be a non-negative integer', {
        evaluationOrder: input.evaluationOrder,
      });
    }
    assertConditionsCoherent(input.conditions);

    return new CaseRoutingRule({
      id: input.id,
      organizationId: input.organizationId,
      name: input.name.trim(),
      evaluationOrder: input.evaluationOrder,
      conditions: input.conditions,
      assignTo: input.assignTo,
      status: input.status ?? 'ACTIVE',
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: CaseRoutingRuleProps): CaseRoutingRule {
    return new CaseRoutingRule(props);
  }

  get id(): CaseRoutingRuleId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get name(): string {
    return this.props.name;
  }

  get evaluationOrder(): number {
    return this.props.evaluationOrder;
  }

  get conditions(): RoutingConditions {
    return this.props.conditions;
  }

  get assignTo(): AssignedTo {
    return this.props.assignTo;
  }

  get status(): RoutingRuleStatus {
    return this.props.status;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): CaseRoutingRuleProps {
    return this.props;
  }

  activate(now: Instant): CaseRoutingRule {
    return new CaseRoutingRule({ ...this.props, status: 'ACTIVE', updatedAt: now });
  }

  deactivate(now: Instant): CaseRoutingRule {
    return new CaseRoutingRule({ ...this.props, status: 'INACTIVE', updatedAt: now });
  }
}

/**
 * Un rango imposible no es una regla que nunca encaja: es un error de quien la
 * escribio, y aceptarlo en silencio deja al inquilino creyendo que enruta algo.
 */
function assertConditionsCoherent(conditions: RoutingConditions): void {
  const { riskScoreMin, riskScoreMax } = conditions;

  for (const [field, value] of [
    ['riskScoreMin', riskScoreMin],
    ['riskScoreMax', riskScoreMax],
  ] as const) {
    if (value !== undefined && (value < 0 || value > 100)) {
      throw invariantViolation(`CaseRoutingRule ${field} must be between 0 and 100`, { [field]: value });
    }
  }

  if (riskScoreMin !== undefined && riskScoreMax !== undefined && riskScoreMin > riskScoreMax) {
    throw invariantViolation('CaseRoutingRule riskScoreMin must not exceed riskScoreMax', {
      riskScoreMin,
      riskScoreMax,
    });
  }
}

import type { Instant } from '../../../../../shared/time/Instant.js';
import type { AmlAlertId } from '../value-objects/AmlAlertId.js';
import type { AmlAlertStatus } from '../value-objects/AmlAlertStatus.js';
import type { AmlAlertSeverity } from '../value-objects/AmlAlertSeverity.js';
import type { MatchScore } from '../value-objects/MatchScore.js';
import type { ScreeningMatch } from '../entities/ScreeningMatch.js';
import { amlAlertStatusTransitions } from '../../services/transitions.js';
import { assertTransitionAllowed } from '../../services/StatusTransitionPolicy.js';
import { invariantViolation } from '../../errors/ScreeningError.js';

/** Closed set of alert types this module raises. Extend as new detection sources land. */
export type AlertType = 'WATCHLIST_MATCH';

export interface AmlAlertProps {
  readonly id: AmlAlertId;
  readonly organizationId: string;
  readonly customerId: string;
  readonly tipoAlerta: AlertType;
  readonly entidadSospechosa: string;
  readonly confianza: MatchScore;
  readonly fuenteDeteccion: string;
  readonly estado: AmlAlertStatus;
  readonly severidad: AmlAlertSeverity;
  readonly matchedEntry: ScreeningMatch;
  readonly caseId: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateAmlAlertInput {
  readonly id: AmlAlertId;
  readonly organizationId: string;
  readonly customerId: string;
  readonly tipoAlerta?: AlertType;
  readonly entidadSospechosa: string;
  readonly confianza: MatchScore;
  readonly fuenteDeteccion: string;
  readonly severidad: AmlAlertSeverity;
  readonly matchedEntry: ScreeningMatch;
  readonly now: Instant;
}

/**
 * Alert raised by watchlist screening (spec RF-3/RF-8: "Persist aml_alerts
 * with matched_entry snapshot" / "Independent AmlAlert lifecycle").
 * Immutable — every mutating method returns a brand-new instance, mirroring
 * `Case`'s private-ctor + create/rehydrate shape. Its lifecycle is entirely
 * independent of any linked `Case` (RF-8: alert transitions never touch the
 * case's own status).
 */
export class AmlAlert {
  private constructor(private readonly props: AmlAlertProps) {}

  static create(input: CreateAmlAlertInput): AmlAlert {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('customerId', input.customerId);
    assertNonEmpty('entidadSospechosa', input.entidadSospechosa);
    assertNonEmpty('fuenteDeteccion', input.fuenteDeteccion);
    return new AmlAlert({
      id: input.id,
      organizationId: input.organizationId,
      customerId: input.customerId,
      tipoAlerta: input.tipoAlerta ?? 'WATCHLIST_MATCH',
      entidadSospechosa: input.entidadSospechosa,
      confianza: input.confianza,
      fuenteDeteccion: input.fuenteDeteccion,
      estado: 'OPEN',
      severidad: input.severidad,
      matchedEntry: input.matchedEntry,
      caseId: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: AmlAlertProps): AmlAlert {
    return new AmlAlert(props);
  }

  get id(): AmlAlertId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get tipoAlerta(): AlertType {
    return this.props.tipoAlerta;
  }

  get entidadSospechosa(): string {
    return this.props.entidadSospechosa;
  }

  get confianza(): MatchScore {
    return this.props.confianza;
  }

  get fuenteDeteccion(): string {
    return this.props.fuenteDeteccion;
  }

  get estado(): AmlAlertStatus {
    return this.props.estado;
  }

  get severidad(): AmlAlertSeverity {
    return this.props.severidad;
  }

  get matchedEntry(): ScreeningMatch {
    return this.props.matchedEntry;
  }

  get caseId(): string | null {
    return this.props.caseId;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): AmlAlertProps {
    return this.props;
  }

  /** Forward-path transition (OPEN -> INVESTIGATING -> RESOLVED|FALSE_POSITIVE). Table-driven. */
  transitionTo(next: AmlAlertStatus, now: Instant): AmlAlert {
    assertTransitionAllowed(amlAlertStatusTransitions, this.props.estado, next);
    return new AmlAlert({ ...this.props, estado: next, updatedAt: now });
  }

  /** Links (or relinks) the alert to a Case, independent of the alert's own lifecycle status. */
  linkCase(caseId: string, now: Instant): AmlAlert {
    return new AmlAlert({ ...this.props, caseId, updatedAt: now });
  }
}

function assertNonEmpty(
  field: 'organizationId' | 'customerId' | 'entidadSospechosa' | 'fuenteDeteccion',
  value: string,
): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`AmlAlert ${field} must be a non-empty string`, { field, value });
  }
}

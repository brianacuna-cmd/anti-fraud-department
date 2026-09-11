import type { Instant } from '../../../../../shared/time/Instant.js';
import type { ActorType } from '../ActorType.js';
import type { AuditLogId } from '../value-objects/AuditLogId.js';

/** Un campo que cambió, con su antes y su después. */
export interface FieldMutation {
  readonly field: string;
  readonly previousValue: unknown;
  readonly newValue: unknown;
}

export interface EntityChangeProps {
  readonly id: AuditLogId;
  readonly organizationId: string | null;
  readonly entityType: string;
  readonly entityId: string;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly mutations: readonly FieldMutation[];
  readonly createdAt: Instant;
}

/**
 * Registro de mutación campo a campo (AUD-001).
 *
 * Vive junto a `AuditLog` y no dentro de él porque responden preguntas
 * distintas. `audit_logs` contesta «¿quién hizo qué?» y basta para reconstruir
 * una operación; `entity_change_log` contesta «¿qué valor tenía este campo el
 * martes?», que es la que aparece cuando alguien discute una cifra concreta
 * meses después.
 *
 * Meterlo todo en `detail` habría sido más fácil y habría hecho imposible la
 * segunda pregunta: no se puede indexar por «campo modificado» dentro de un
 * objeto libre que cada emisor rellena a su manera.
 *
 * Como `AuditLog`, es de solo escritura: no hay `update` ni `delete`. Un
 * registro de cambios que se puede cambiar no registra nada.
 */
export class EntityChange {
  private constructor(private readonly props: EntityChangeProps) {}

  static create(props: EntityChangeProps): EntityChange {
    return new EntityChange(props);
  }

  static rehydrate(props: EntityChangeProps): EntityChange {
    return new EntityChange(props);
  }

  get id(): AuditLogId {
    return this.props.id;
  }
  get organizationId(): string | null {
    return this.props.organizationId;
  }
  get entityType(): string {
    return this.props.entityType;
  }
  get entityId(): string {
    return this.props.entityId;
  }
  get actorType(): ActorType {
    return this.props.actorType;
  }
  get actorId(): string | null {
    return this.props.actorId;
  }
  get mutations(): readonly FieldMutation[] {
    return this.props.mutations;
  }
  get createdAt(): Instant {
    return this.props.createdAt;
  }

  toProps(): EntityChangeProps {
    return this.props;
  }
}

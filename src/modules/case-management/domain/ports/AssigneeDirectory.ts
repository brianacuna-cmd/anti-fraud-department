/**
 * Comprobación de que el destinatario de una asignación existe de verdad.
 *
 * `AssignedTo` es una referencia opaca por diseño (ADR-0: los ids de otro
 * módulo se guardan como cadenas), así que el dominio no puede resolverla por
 * sí mismo. Sin este puerto, asignar aceptaba cualquier cadena: un usuario
 * borrado, un id mal escrito o el de otro inquilino quedaban guardados como si
 * fueran válidos y el caso se volvía huérfano — con dueño en la base de datos,
 * pero sin nadie a quien reclamar.
 */

/** Naturaleza del actor detrás de un id opaco de la línea de tiempo. */
export type ActorKind = 'USER' | 'ORGANIZATION' | 'ROLE' | 'SYSTEM' | 'UNKNOWN';

export interface ResolvedActor {
  readonly id: string;
  readonly kind: ActorKind;
  /** Nombre presentable. Nunca vacío: para `UNKNOWN` cae al propio id. */
  readonly name: string;
}

export interface AssigneeDirectory {
  /** El usuario existe y pertenece a esa organización. */
  userExists(organizationId: string, userId: string): Promise<boolean>;

  /** El rol existe como destinatario de asignaciones. */
  roleExists(roleId: string): Promise<boolean>;

  /**
   * Traduce los ids que firman los eventos de la línea de tiempo a nombres.
   *
   * Vive en el backend y no en el cliente porque el cliente no puede hacerlo:
   * `GET /organizations/:id` exige PLATFORM_ADMIN, de modo que un panel
   * abierto por un analista jamás podrá averiguar el nombre de la
   * organización que firmó una acción. Y esa firma es la habitual — un actor
   * ORGANIZATION estampa el id del inquilino en `CreatedBy`, porque
   * `auth.userId` no admite null y lleva ese valor.
   *
   * Resolver aquí cubre de una vez a personas, organizaciones, roles y los
   * centinelas del sistema, sin exponer permisos de lectura que el panel no
   * debería tener.
   */
  resolveActors(organizationId: string, ids: readonly string[]): Promise<readonly ResolvedActor[]>;
}

import type { Db } from 'mongodb';
import type {
  AssigneeDirectory,
  ResolvedActor,
} from '../../../../domain/ports/AssigneeDirectory.js';

/**
 * Centinelas que las vias de intake automaticas estampan como autor. No
 * corresponden a ninguna fila, asi que se traducen sin tocar la base.
 */
const SYSTEM_ACTOR_NAMES: Readonly<Record<string, string>> = {
  SYSTEM_WEBHOOK: 'Finturu (webhook)',
  SYSTEM_SYNC: 'Sincronizacion automatica',
  SYSTEM: 'Sistema',
  PLATFORM_ADMIN: 'Administrador de plataforma',
};

/** Nombre presentable de un documento de usuario, con el email como respaldo. */
function userDisplayName(doc: Record<string, any>): string {
  const full = [doc.FirstName, doc.LastName].filter(Boolean).join(' ').trim();
  return full || doc.Email || String(doc._id);
}

/**
 * Resuelve destinatarios contra las colecciones de identity-access.
 *
 * Vive en la capa de infraestructura de case-management, no en el dominio:
 * es el punto donde una referencia opaca se contrasta con el módulo dueño del
 * dato, sin que el dominio importe nada de identity-access.
 */
export class MongoAssigneeDirectory implements AssigneeDirectory {
  constructor(private readonly db: Db) {}

  async userExists(organizationId: string, userId: string): Promise<boolean> {
    if (!userId.trim()) return false;

    // El filtro por organización es lo que impide asignar un caso a alguien de
    // otro inquilino, que se vería igual de "válido" mirando solo el id.
    const count = await this.db
      .collection('Users')
      .countDocuments({ _id: userId as never, OrganizationId: organizationId }, { limit: 1 });
    return count > 0;
  }

  async roleExists(roleId: string): Promise<boolean> {
    if (!roleId.trim()) return false;

    // `Rol` usa el propio nombre del rol como `_id` (ADMIN, ANALYST, …).
    const count = await this.db
      .collection('Rol')
      .countDocuments({ _id: roleId as never, DeletedAt: null }, { limit: 1 });
    return count > 0;
  }

  async resolveActors(organizationId: string, ids: readonly string[]): Promise<readonly ResolvedActor[]> {
    const unique = [...new Set(ids.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return [];

    const resolved = new Map<string, ResolvedActor>();
    const pending: string[] = [];

    for (const id of unique) {
      const systemName = SYSTEM_ACTOR_NAMES[id];
      if (systemName) {
        resolved.set(id, { id, kind: 'SYSTEM', name: systemName });
      } else {
        pending.push(id);
      }
    }

    if (pending.length > 0) {
      // Las tres consultas van en paralelo y por lotes: la linea de tiempo de
      // un caso trae decenas de eventos y resolverlos de uno en uno convertia
      // una peticion en decenas de idas y venidas a la base.
      const [users, organizations, roles] = await Promise.all([
        this.db
          .collection('Users')
          .find({ _id: { $in: pending as never[] }, OrganizationId: organizationId })
          .toArray(),
        this.db
          .collection('Organizations')
          .find({ _id: { $in: pending as never[] } })
          .toArray(),
        this.db
          .collection('Rol')
          .find({ _id: { $in: pending as never[] } })
          .toArray(),
      ]);

      for (const doc of users) {
        resolved.set(String(doc._id), { id: String(doc._id), kind: 'USER', name: userDisplayName(doc) });
      }
      // Las organizaciones se resuelven despues de los usuarios pero no los
      // pisan: un id no puede ser ambas cosas, y si lo fuese la persona es la
      // lectura util para quien audita.
      for (const doc of organizations) {
        const id = String(doc._id);
        if (resolved.has(id)) continue;
        resolved.set(id, { id, kind: 'ORGANIZATION', name: doc.Name ?? doc.LegalName ?? id });
      }
      for (const doc of roles) {
        const id = String(doc._id);
        if (resolved.has(id)) continue;
        resolved.set(id, { id, kind: 'ROLE', name: doc.Name ?? id });
      }
    }

    // Un id que no resuelve se devuelve igualmente, con su propio valor como
    // nombre: omitirlo dejaria al cliente sin nada que mostrar y de vuelta al
    // problema que este metodo viene a resolver.
    return unique.map(
      (id) => resolved.get(id) ?? { id, kind: 'UNKNOWN' as const, name: id },
    );
  }
}

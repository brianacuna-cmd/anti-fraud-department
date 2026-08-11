import { invariantViolation } from '../../errors/NotificationsError.js';

/**
 * The kind of actor recording a `NOTIFICATION_PREFERENCE_UPDATED` audit
 * event. Mirrors `shared/kernel/AuthContext.ts`'s `ActorType` union exactly,
 * but lives here too (module-owned copy per design D15): `shared/**` may not
 * depend on any module (eslint `boundaries`), and a module may not import
 * another module's domain VOs. Not branded — a closed enum, not an opaque id.
 */
export type ActorType = 'USER' | 'ORGANIZATION' | 'PLATFORM_ADMIN';

const VALID_ACTOR_TYPES: ReadonlySet<string> = new Set<ActorType>(['USER', 'ORGANIZATION', 'PLATFORM_ADMIN']);

export function createActorType(value: string): ActorType {
  if (!VALID_ACTOR_TYPES.has(value)) {
    throw invariantViolation('ActorType must be one of USER, ORGANIZATION, PLATFORM_ADMIN', { value });
  }
  return value as ActorType;
}

import { invariantViolation } from '../../errors/IdentityAccessError.js';

/**
 * The kind of actor a `Sessions` row belongs to (design D14/D37). Mirrors
 * `shared/kernel/AuthContext.ts`'s `ActorType` union exactly, but lives here
 * too (design judgment call, PR3b): `shared/**` may not depend on any module
 * (eslint `boundaries`), while `Session`/`SessionDocument` need a validated
 * domain-level value distinct from the HTTP-layer kernel type. Not branded
 * (like `OrganizationStatus.ts`) — this is a closed enum, not an opaque id.
 */
export type ActorType = 'USER' | 'ORGANIZATION' | 'PLATFORM_ADMIN';

const VALID_ACTOR_TYPES: ReadonlySet<string> = new Set<ActorType>(['USER', 'ORGANIZATION', 'PLATFORM_ADMIN']);

export function createActorType(value: string): ActorType {
  if (!VALID_ACTOR_TYPES.has(value)) {
    throw invariantViolation('ActorType must be one of USER, ORGANIZATION, PLATFORM_ADMIN', { value });
  }
  return value as ActorType;
}

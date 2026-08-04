/**
 * The actor requesting a status transition, reduced to the single fact the
 * domain-level reactivation gate needs (design D2): whether they are a
 * platform administrator. The application layer resolves this from
 * `AuthContext`; the domain never sees the rest of the auth context.
 */
export interface TransitionActor {
  readonly isPlatformAdmin: boolean;
}

export function createTransitionActor(isPlatformAdmin: boolean): TransitionActor {
  return { isPlatformAdmin };
}

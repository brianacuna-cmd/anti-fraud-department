/**
 * The authenticated caller for the current request, resolved by whichever
 * `AuthContextResolver` is active (design D4). Real JWT middleware later
 * swaps the resolver only — the shape stays the same.
 */
export interface AuthContext {
  readonly userId: string;
  readonly organizationId: string;
  readonly isPlatformAdmin: boolean;
}

export interface CreateAuthContextInput {
  readonly userId: string;
  readonly organizationId: string;
  readonly isPlatformAdmin?: boolean;
}

/**
 * `isPlatformAdmin` absent => `false` (design: additive, optional field).
 */
export function createAuthContext(input: CreateAuthContextInput): AuthContext {
  return {
    userId: input.userId,
    organizationId: input.organizationId,
    isPlatformAdmin: input.isPlatformAdmin ?? false,
  };
}

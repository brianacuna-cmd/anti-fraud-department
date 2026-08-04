import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { User } from '../domain/model/aggregates/User.js';
import type { createTransitionUserStatusUseCase } from './TransitionUserStatus.js';

export interface DeleteUserInput {
  readonly auth: AuthContext;
  readonly userId: string;
}

export interface DeleteUserDeps {
  readonly transitionUserStatus: ReturnType<typeof createTransitionUserStatusUseCase>;
}

/**
 * HTTP sugar (user-lifecycle spec: "Soft Delete as Status Transition").
 * Calls the exact same use case as `/transition` with `next=DESHABILITADO` —
 * never a parallel implementation.
 */
export function createDeleteUserUseCase(deps: DeleteUserDeps) {
  return async function deleteUser(input: DeleteUserInput): Promise<User> {
    return deps.transitionUserStatus({ auth: input.auth, userId: input.userId, next: 'DESHABILITADO' });
  };
}

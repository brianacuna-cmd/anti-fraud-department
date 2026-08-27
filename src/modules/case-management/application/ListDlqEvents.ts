import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { OutboxDlqRepository } from '../../../shared/outbox/OutboxDlqRepository.js';
import type { DeadLetterEvent } from '../../../shared/outbox/DeadLetterEvent.js';
import type { CursorPage } from '../../../shared/http/pagination.js';
import { decodeDescCursor } from '../../../shared/http/pagination.js';
import { requirePlatformAdmin } from './authorization/requirePlatformAdmin.js';
import { invariantViolation } from '../domain/errors/CaseManagementError.js';

export interface ListDlqEventsInput {
  readonly auth: AuthContext;
  readonly limit: number;
  readonly cursor?: string;
  readonly organizationId?: string;
}

export interface ListDlqEventsDeps {
  readonly dlq: OutboxDlqRepository;
}

/**
 * Returns a newest-first paginated list of DLQ event metadata. PLATFORM_ADMIN
 * only (D1). `organizationId` is an optional cross-tenant filter supplied
 * explicitly by the caller — PLATFORM_ADMIN has `auth.organizationId: null`
 * and therefore can never inadvertently scope to a single tenant.
 *
 * A malformed `cursor` is rejected as `INVARIANT_VIOLATION` (400) before the
 * repository is called — never silently reset to page 1 (D3).
 */
export function createListDlqEventsUseCase(deps: ListDlqEventsDeps) {
  return async function listDlqEvents(
    input: ListDlqEventsInput,
  ): Promise<CursorPage<DeadLetterEvent>> {
    requirePlatformAdmin(input.auth);

    if (input.cursor !== undefined) {
      const decoded = decodeDescCursor(input.cursor);
      if (decoded === null) {
        throw invariantViolation('malformed pagination cursor: not a valid desc cursor', {
          cursor: input.cursor,
        });
      }
    }

    return deps.dlq.findMany({
      limit: input.limit,
      cursor: input.cursor,
      organizationId: input.organizationId,
    });
  };
}

export type ListDlqEventsService = ReturnType<typeof createListDlqEventsUseCase>;

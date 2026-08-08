import type { AuditEvent, AuditRecorder } from '../modules/identity-access/domain/ports/AuditRecorder.js';
import type { Transaction as IdentityAccessTransaction } from '../modules/identity-access/domain/ports/UnitOfWork.js';
import type { createRecordAuditLogUseCase } from '../modules/audit/application/RecordAuditLog.js';
import type { Transaction as AuditTransaction } from '../modules/audit/domain/ports/UnitOfWork.js';

/**
 * Composition-root bridge (design D-A2/D-A4): implements identity-access's
 * OWN `AuditRecorder` port by delegating to the `audit` module's
 * `RecordAuditLog` use case. This file lives OUTSIDE every module's
 * `domain`/`application`/`infrastructure` folders (like `main.ts` itself) —
 * it is the one legal seam where a cross-module import (identity-access's
 * port depending on the audit module's use case) is allowed by
 * `eslint-plugin-boundaries`, matching how `main.ts` already constructs
 * `UserActorGateway`, `dummyCredential`, etc.
 *
 * `tx` is identity-access's OWN opaque `Transaction`; `recordAuditLog` wants
 * the `audit` module's OWN opaque `Transaction`. Both are the same runtime
 * `ClientSession` (design D-A4) — this is the SINGLE documented cast that
 * bridges the two nominal types; no other code in the repo casts between
 * them.
 *
 * Extracted into its own file (rather than inlined in `main.ts`) so the
 * bridging logic is independently unit-testable. `main.ts` wires this
 * adapter into use case factories once the first audited use case is
 * retrofitted (Phase 4/5/6 — later stacked PRs); until then, constructing
 * it in `main.ts` with no consumer would be dead code.
 */
export function createAuditRecorderAdapter(
  recordAuditLog: ReturnType<typeof createRecordAuditLogUseCase>,
): AuditRecorder {
  return {
    async record(event: AuditEvent, tx?: IdentityAccessTransaction): Promise<void> {
      await recordAuditLog(
        {
          organizationId: event.organizationId,
          actorType: event.actorType,
          actorId: event.actorId,
          action: event.action,
          resource: event.resource,
          resourceId: event.resourceId,
          detail: event.detail,
          ipAddress: event.ipAddress,
        },
        tx as unknown as AuditTransaction | undefined,
      );
    },
  };
}

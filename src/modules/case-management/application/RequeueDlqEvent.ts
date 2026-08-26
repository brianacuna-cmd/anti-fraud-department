import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { OutboxDlqRepository } from '../../../shared/outbox/OutboxDlqRepository.js';
import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createOutboxEventId, generateOutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';
import { requirePlatformAdmin } from './authorization/requirePlatformAdmin.js';
import { dlqEventNotFound } from '../domain/errors/CaseManagementError.js';

export interface RequeueDlqEventInput {
  readonly auth: AuthContext;
  readonly dlqEventId: string;
}

export interface RequeueDlqEventDeps {
  readonly dlq: OutboxDlqRepository;
  readonly outbox: OutboxEventRepository;
  readonly unitOfWork: UnitOfWork;
  readonly auditRecorder: AuditRecorder;
}

export interface RequeueDlqEventResult {
  readonly newOutboxId: string;
}

/**
 * Atomically replays a dead-lettered event: deletes the DLQ row and inserts a
 * new PENDING outbox event with a fresh id and `publishAttempts = 0`, both
 * within a single `unitOfWork.withTransaction`. Emits `DLQ_REQUEUED` audit
 * with `originalDlqId` + `newOutboxId` (D6). PLATFORM_ADMIN only (D1).
 *
 * Design notes (D2):
 * - A fresh id is mandatory: the DLQ `_id` IS the original `OutboxEventId`,
 *   and `MongoOutboxDlqRepository.save` swallows E11000 as "already moved".
 *   Reusing the id would cause a second exhaustion to silently disappear.
 * - Deleting the DLQ row is mandatory for the same reason: leaving it would
 *   make a second exhaustion collide on `_id` and be swallowed as a no-op.
 */
export function createRequeueDlqEventUseCase(deps: RequeueDlqEventDeps) {
  return async function requeueDlqEvent(
    input: RequeueDlqEventInput,
  ): Promise<RequeueDlqEventResult> {
    requirePlatformAdmin(input.auth);

    const originalId = createOutboxEventId(input.dlqEventId);
    const dlqRow = await deps.dlq.findById(originalId);
    if (dlqRow === null) {
      throw dlqEventNotFound(input.dlqEventId);
    }

    const newId = generateOutboxEventId();

    await deps.unitOfWork.withTransaction(async (tx) => {
      await deps.dlq.delete(originalId, tx);

      const requeued = OutboxEvent.create({
        id: newId,
        organizationId: dlqRow.organizationId,
        eventType: dlqRow.eventType,
        aggregateType: dlqRow.aggregateType,
        aggregateId: dlqRow.aggregateId,
        payload: dlqRow.payload,
        now: dlqRow.exhaustedAt,
      });
      await deps.outbox.save(requeued, tx);

      await deps.auditRecorder.record(
        {
          organizationId: dlqRow.organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'DLQ_REQUEUED',
          resource: 'dlq_event',
          resourceId: originalId,
          detail: { originalDlqId: originalId, newOutboxId: newId },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );
    });

    return { newOutboxId: newId };
  };
}

export type RequeueDlqEventService = ReturnType<typeof createRequeueDlqEventUseCase>;

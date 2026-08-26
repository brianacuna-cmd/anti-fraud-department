import type { OutboxDlqRepository } from './OutboxDlqRepository.js';

/**
 * Compile-only stub used in `main.ts` until `MongoOutboxDlqRepository` is
 * wired in PR 2. Throws at runtime so a misconfigured deployment fails
 * loudly at the DLQ write rather than silently swallowing exhausted events.
 *
 * PR 2 replaces this with `MongoOutboxDlqRepository`. Do NOT deploy PR 1
 * alone if exhaustion is reachable in production and silent data loss is
 * unacceptable; use this only as a compile-time bridge.
 */
export class UnimplementedOutboxDlqRepository implements OutboxDlqRepository {
  async save(): Promise<void> {
    throw new Error(
      '[outbox-dlq] DLQ not wired — MongoOutboxDlqRepository is delivered in PR 2. ' +
        'Deploy PR 1 only when the exhaustion path is unreachable in this environment.',
    );
  }
}

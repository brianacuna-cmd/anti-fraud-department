import { DomainError } from '../kernel/DomainError.js';

/** Shared outbox domain error (invariant violations on outbox value objects). */
export class OutboxError extends DomainError {
  constructor(message: string, metadata: Readonly<Record<string, unknown>> = {}) {
    super('OUTBOX_INVARIANT_VIOLATION', message, metadata);
  }
}

export function outboxInvariant(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): OutboxError {
  return new OutboxError(message, metadata);
}

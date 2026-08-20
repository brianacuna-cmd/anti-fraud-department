/**
 * Inbound handle for the background SLA sweep scheduler (Slice 13). Kept
 * minimal — `SweepSlaTracking` is the actual use case; this port only
 * describes the lifecycle handle returned by `start()` so callers (tests,
 * `main.ts`) never depend on the concrete infra adapter's shape.
 */
export interface SlaSchedulerHandle {
  stop(): void;
}

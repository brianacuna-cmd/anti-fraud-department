import { ZenEngine } from '@gorules/zen-engine';
import type {
  CaseRoutingContext,
  RoutingEngine,
  RoutingEvaluation,
} from '../../../../domain/ports/RoutingEngine.js';

/**
 * `@gorules/zen-engine` adapter for the `RoutingEngine` port (design: "ZEN
 * Engine — T1 only"). The only place in the module allowed to import
 * `@gorules/zen-engine`, mirroring how `OtplibTotpService` is the sole otplib
 * importer in identity-access.
 *
 * Each `evaluate` compiles the rule's JDM graph into a `ZenDecision` and runs
 * the case context through it (JDM graphs differ per rule, so there is nothing
 * to cache across calls in this first cut — design "no decision caching in the
 * first ZEN slice"; the owning `ZenEngine` is released via `dispose`). A ZEN result
 * that yields neither a `targetUserId` nor a `targetRoleId` (no rule row hit
 * under the `first` hit policy) maps to null targets, which `RouteCase` reads
 * as "this rule did not assign anyone".
 */
export class ZenRoutingEngine implements RoutingEngine {
  private readonly engine: ZenEngine;

  constructor(engine: ZenEngine = new ZenEngine()) {
    this.engine = engine;
  }

  async evaluate(
    conditions: Readonly<Record<string, unknown>>,
    context: CaseRoutingContext,
  ): Promise<RoutingEvaluation> {
    const decision = this.engine.createDecision(conditions);
    const { result } = await decision.evaluate({
      riskScore: context.riskScore,
      status: context.status,
      priority: context.priority,
      tags: context.tags,
    });
    return toEvaluation(result);
  }

  /** Releases the native ZEN engine handle. Call at composition-root shutdown. */
  dispose(): void {
    this.engine.dispose();
  }
}

function toEvaluation(result: unknown): RoutingEvaluation {
  const output = (result ?? {}) as Record<string, unknown>;
  return {
    targetUserId: asNonEmptyString(output.targetUserId),
    targetRoleId: asNonEmptyString(output.targetRoleId),
  };
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

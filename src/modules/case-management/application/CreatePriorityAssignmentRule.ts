import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseRoutingRule } from '../domain/model/aggregates/CaseRoutingRule.js';
import type { createCreateRoutingRuleUseCase } from './CreateRoutingRule.js';
import { createCasePriority, type CasePriority } from '../domain/model/value-objects/CasePriority.js';
import { createAssignedTo, type AssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import { invariantViolation } from '../domain/errors/CaseManagementError.js';

export interface PriorityAssignmentMappingInput {
  readonly priority: string;
  readonly target: { readonly type: string; readonly id: string };
}

export interface CreatePriorityAssignmentRuleInput {
  readonly auth: AuthContext;
  readonly name: string;
  readonly mappings: readonly PriorityAssignmentMappingInput[];
}

export interface CreatePriorityAssignmentRuleDeps {
  /** Reuses the existing draft-create use case: same persistence, same audit row. */
  readonly createRoutingRule: ReturnType<typeof createCreateRoutingRuleUseCase>;
}

/**
 * CFG-002 wrapper for "priority X always goes to target Y" — the common
 * case supervisors actually want, without hand-authoring a ZEN/JDM graph.
 *
 * `RouteCase.ts` already reads `priority` into the routing context and
 * already supports `USER`/`ROLE` targets; this use case only SHAPES the
 * `conditions` graph (one decision-table row per priority, `hitPolicy:
 * 'first'`) and hands it to the real `createRoutingRule` use case, which
 * still owns persistence, audit and the INACTIVE-draft rule (an ACTIVATE
 * call is still required to go live — one path to publish, same as a
 * hand-authored rule).
 *
 * The rule-level `targetRoleId`/`targetUserId` fields are deliberately
 * left `null`. `RouteCase.resolveAssignment` falls back to them whenever
 * the JDM row does not produce a target — so if they were set here, EVERY
 * priority would resolve to the same target the moment its own row didn't
 * match, silently defeating the whole per-priority table.
 */
export function createCreatePriorityAssignmentRuleUseCase(deps: CreatePriorityAssignmentRuleDeps) {
  return async function createPriorityAssignmentRule(
    input: CreatePriorityAssignmentRuleInput,
  ): Promise<CaseRoutingRule> {
    if (input.mappings.length === 0) {
      throw invariantViolation('mappings must include at least one priority -> target row', {
        name: input.name,
      });
    }

    const mappings = input.mappings.map((mapping) => ({
      priority: createCasePriority(mapping.priority),
      target: createAssignedTo(mapping.target.type, mapping.target.id),
    }));

    return deps.createRoutingRule({
      auth: input.auth,
      name: input.name,
      conditions: buildPriorityAssignmentJdm(mappings),
      targetRoleId: null,
      targetUserId: null,
    });
  };
}

export interface PriorityAssignmentMapping {
  readonly priority: CasePriority;
  readonly target: AssignedTo;
}

/**
 * One `decisionTableNode` with `hitPolicy: 'first'`, one input field
 * (`priority`) and two output fields (`targetUserId`/`targetRoleId`) — same
 * shape `ZenRoutingEngine.ts` already parses (see
 * `tests/integration/case-management/ZenRoutingEngine.test.ts` for the
 * hand-authored equivalent this mirrors). Exported for direct unit testing
 * of the graph shape.
 */
export function buildPriorityAssignmentJdm(
  mappings: readonly PriorityAssignmentMapping[],
): Record<string, unknown> {
  return {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'input', type: 'inputNode', name: 'Request', position: { x: 0, y: 0 } },
      {
        id: 'table',
        type: 'decisionTableNode',
        name: 'Priority routing',
        position: { x: 200, y: 0 },
        content: {
          hitPolicy: 'first',
          inputs: [{ id: 'i1', name: 'Priority', field: 'priority' }],
          outputs: [
            { id: 'o1', name: 'Target User', field: 'targetUserId' },
            { id: 'o2', name: 'Target Role', field: 'targetRoleId' },
          ],
          rules: mappings.map((mapping, index) => ({
            _id: `r${index + 1}`,
            i1: expressionLiteral(mapping.priority),
            o1: mapping.target.type === 'USER' ? expressionLiteral(mapping.target.id) : 'null',
            o2: mapping.target.type === 'ROLE' ? expressionLiteral(mapping.target.id) : 'null',
          })),
        },
      },
      { id: 'output', type: 'outputNode', name: 'Response', position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: 'e1', sourceId: 'input', targetId: 'table' },
      { id: 'e2', sourceId: 'table', targetId: 'output' },
    ],
  };
}

/** Quotes a value for the ZEN expression language, escaping embedded quotes/backslashes. */
function expressionLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

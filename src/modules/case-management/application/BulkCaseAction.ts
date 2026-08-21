import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import type { UnitOfWork, Transaction } from '../domain/ports/UnitOfWork.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { AssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import type { CasePriority } from '../domain/model/value-objects/CasePriority.js';
import type { TimelineEventType } from '../domain/model/value-objects/TimelineEventType.js';
import { Case, normalizeTags } from '../domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createAssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import { createCasePriority } from '../domain/model/value-objects/CasePriority.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import {
  caseNotFound,
  forbiddenCrossTenant,
  invariantViolation,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, CASE_WORK_ROLES } from './authorization/policy.js';

const MAX_BULK_CASES = 100;

export type BulkCaseAction =
  | { readonly type: 'ASSIGN'; readonly assignedToType: string; readonly assignedToId: string }
  | { readonly type: 'CHANGE_PRIORITY'; readonly priority: string }
  | { readonly type: 'ADD_TAGS'; readonly tags: readonly string[] };

export interface BulkCaseActionInput {
  readonly auth: AuthContext;
  readonly caseIds: readonly string[];
  readonly action: BulkCaseAction;
}

export interface BulkCaseActionResult {
  readonly cases: readonly Case[];
  /** Ids of the cases whose state actually changed (a no-op is skipped). */
  readonly changedCaseIds: readonly string[];
}

export interface BulkCaseActionDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly assigneeDirectory: AssigneeDirectory;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
}

interface AppliedChange {
  readonly updated: Case;
  readonly eventType: TimelineEventType;
  readonly previousValue: string | null;
  readonly newValue: string | null;
  readonly detail: Record<string, unknown>;
}

/**
 * POST /cases/bulk-action. Applies ONE action (ASSIGN | CHANGE_PRIORITY |
 * ADD_TAGS) to a selection of cases atomically. Role-gated to
 * ANALYST|SUPERVISOR. Scope (design "bulk-action tables"): cases,
 * case_timeline, audit_logs — SLA is intentionally NOT recomputed on a bulk
 * priority change (that is a triage relabel; the per-case
 * PATCH /cases/:id/priority-tags path owns SLA recalculation). All-or-nothing:
 * a missing/soft-deleted or cross-tenant case aborts the whole batch. Per-case
 * no-ops are skipped (no timeline/audit noise) but still returned.
 */
export function createBulkCaseActionUseCase(deps: BulkCaseActionDeps) {
  return async function bulkCaseAction(
    input: BulkCaseActionInput,
  ): Promise<BulkCaseActionResult> {
    requireOperationalRole(input.auth, CASE_WORK_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const caseIds = dedupe(input.caseIds);
    if (caseIds.length === 0) {
      throw invariantViolation('bulk action requires at least one case id');
    }
    if (caseIds.length > MAX_BULK_CASES) {
      throw invariantViolation(`bulk action is limited to ${MAX_BULK_CASES} cases per request`, {
        received: caseIds.length,
      });
    }
    const resolvedAction = await resolveAction(input.action, organizationId, deps);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const now = deps.clock.now();
      const loaded = await loadAll(caseIds, organizationId, deps, tx);

      const results: Case[] = [];
      const changedCaseIds: string[] = [];
      for (const existing of loaded) {
        const change = applyAction(existing, resolvedAction, now);
        if (change === null) {
          results.push(existing);
          continue;
        }
        await persistChange(change, input.auth, organizationId, now, deps, tx);
        results.push(change.updated);
        changedCaseIds.push(change.updated.id);
      }

      return { cases: results, changedCaseIds };
    });
  };
}

type ResolvedAction =
  | { readonly type: 'ASSIGN'; readonly assignedTo: AssignedTo }
  | { readonly type: 'CHANGE_PRIORITY'; readonly priority: CasePriority }
  | { readonly type: 'ADD_TAGS'; readonly tags: readonly string[] };

async function resolveAction(
  action: BulkCaseAction,
  organizationId: string,
  deps: BulkCaseActionDeps,
): Promise<ResolvedAction> {
  if (action.type === 'CHANGE_PRIORITY') {
    return { type: 'CHANGE_PRIORITY', priority: createCasePriority(action.priority) };
  }
  if (action.type === 'ADD_TAGS') {
    const tags = normalizeTags(action.tags);
    if (tags.length === 0) {
      throw invariantViolation('ADD_TAGS requires at least one non-empty tag');
    }
    return { type: 'ADD_TAGS', tags };
  }
  const assignedTo = createAssignedTo(action.assignedToType, action.assignedToId);
  const inOrg = await deps.assigneeDirectory.belongsToOrganization(organizationId, assignedTo);
  if (!inOrg) {
    throw forbiddenCrossTenant('assignee does not belong to the case organization');
  }
  return { type: 'ASSIGN', assignedTo };
}

async function loadAll(
  caseIds: readonly string[],
  organizationId: string,
  deps: BulkCaseActionDeps,
  tx: Transaction,
): Promise<Case[]> {
  const loaded: Case[] = [];
  for (const rawId of caseIds) {
    const caseId = createCaseId(rawId);
    const existing = await deps.cases.findById(caseId, tx);
    if (existing === null || existing.deletedAt !== null) {
      throw caseNotFound(caseId);
    }
    if (existing.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }
    loaded.push(existing);
  }
  return loaded;
}

function applyAction(existing: Case, action: ResolvedAction, now: Instant): AppliedChange | null {
  if (action.type === 'ASSIGN') {
    return applyAssign(existing, action.assignedTo, now);
  }
  if (action.type === 'CHANGE_PRIORITY') {
    return applyChangePriority(existing, action.priority, now);
  }
  return applyAddTags(existing, action.tags, now);
}

function applyAssign(existing: Case, assignedTo: AssignedTo, now: Instant): AppliedChange | null {
  const current = existing.assignedTo;
  if (current !== null && current.type === assignedTo.type && current.id === assignedTo.id) {
    return null;
  }
  return {
    updated: existing.reassign(assignedTo, now),
    eventType: 'ASSIGNED',
    previousValue: current?.id ?? null,
    newValue: assignedTo.id,
    detail: {
      bulkActionType: 'ASSIGN',
      assignedToType: assignedTo.type,
      assignedToId: assignedTo.id,
      previousAssignedToId: current?.id ?? null,
    },
  };
}

function applyChangePriority(
  existing: Case,
  priority: CasePriority,
  now: Instant,
): AppliedChange | null {
  if (existing.priority === priority) {
    return null;
  }
  return {
    updated: existing.updatePriorityAndTags(priority, existing.tags, now),
    eventType: 'PRIORITY_CHANGED',
    previousValue: existing.priority,
    newValue: priority,
    detail: {
      bulkActionType: 'CHANGE_PRIORITY',
      previousPriority: existing.priority,
      newPriority: priority,
    },
  };
}

function applyAddTags(
  existing: Case,
  tags: readonly string[],
  now: Instant,
): AppliedChange | null {
  const previousTags = [...existing.tags];
  const merged = normalizeTags([...previousTags, ...tags]);
  if (merged.length === previousTags.length) {
    return null;
  }
  return {
    updated: existing.updatePriorityAndTags(existing.priority, merged, now),
    eventType: 'TAGS_UPDATED',
    previousValue: previousTags.join(',') || null,
    newValue: merged.join(',') || null,
    detail: {
      bulkActionType: 'ADD_TAGS',
      addedTags: tags,
      previousTags,
      newTags: merged,
    },
  };
}

async function persistChange(
  change: AppliedChange,
  auth: AuthContext,
  organizationId: string,
  now: Instant,
  deps: BulkCaseActionDeps,
  tx: Transaction,
): Promise<void> {
  await deps.cases.save(change.updated, tx);
  await deps.timelineRecorder.record(
    CaseTimelineEvent.create({
      id: deps.generateTimelineEventId(),
      caseId: change.updated.id,
      eventType: change.eventType,
      previousValue: change.previousValue,
      newValue: change.newValue,
      createdBy: auth.userId,
      createdAt: now,
    }),
    tx,
  );
  await deps.auditRecorder.record(
    {
      organizationId,
      actorType: auth.actorType,
      actorId: auth.userId,
      action: 'BULK_CASE_ACTION',
      resource: 'case',
      resourceId: change.updated.id,
      detail: change.detail,
      ipAddress: auth.ipAddress,
    },
    tx,
  );
}

function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

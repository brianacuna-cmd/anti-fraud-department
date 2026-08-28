/**
 * case-management's OWN closed Action/Resource vocabulary for audit
 * emission (design "Cross-module seams: Audit reuse"). Plain unions, NOT
 * branded — mirrors `IdentityAccessAuditAction`/`IdentityAccessAuditResource`.
 *
 * Only Slice 5's action (`CREATE_CASE`) is wired to a real use case yet;
 * the remaining actions are declared now (design's fixed list) so later
 * slices (6-13) don't need to touch this file again.
 */
export type CaseManagementAuditAction =
  | 'CREATE_CASE'
  | 'UPDATE_SCORE'
  | 'START_REVIEW'
  | 'RESOLVE_CASE'
  | 'ARCHIVE_CASE'
  | 'REASSIGN_CASE'
  | 'REOPEN_CASE'
  | 'UPDATE_PRIORITY_TAGS'
  | 'BULK_CASE_ACTION'
  | 'ADD_CASE_NOTE'
  | 'OPEN_INVESTIGATION'
  | 'CLOSE_INVESTIGATION'
  | 'UPDATE_INVESTIGATION_FINDINGS'
  | 'UPDATE_INVESTIGATION_STATUS'
  | 'GENERATE_CASE_REPORT'
  | 'REGISTER_EVIDENCE'
  | 'DELETE_EVIDENCE'
  | 'DELETE_CASE_NOTE'
  | 'RECORD_ANALYST_DECISION'
  /**
   * ENF-001: the measure was requested on its own, not as an effect of a
   * decision. It is audited separately from `RECORD_ANALYST_DECISION` because
   * the question a regulator asks —who requested restricting this money and
   * with what verdict behind it— is answered differently in each case.
   */
  | 'REQUEST_ENFORCEMENT_ACTION'
  | 'APPROVE_ENFORCEMENT_ACTION'
  | 'REJECT_ENFORCEMENT_ACTION'
  | 'REVIEW_APPROVAL_REQUEST'
  | 'EXECUTE_ENFORCEMENT_ACTION'
  | 'REVERT_ENFORCEMENT_ACTION'
  | 'CREATE_ROUTING_RULE'
  /**
   * SUPERVISOR PATCH of name, conditions, and/or targets. Status changes
   * only via ACTIVATE_ROUTING_RULE / DEACTIVATE_ROUTING_RULE. A no-op PATCH
   * does not emit this action.
   */
  | 'UPDATE_ROUTING_RULE'
  /**
   * SUPERVISOR PUT `/case-routing-rules/reorder`. Catalog-wide permutation;
   * `resourceId` is null and `detail.ids` is the requested order. Identity
   * order does not emit this action.
   */
  | 'REORDER_ROUTING_RULES'
  | 'ACTIVATE_ROUTING_RULE'
  | 'DEACTIVATE_ROUTING_RULE'
  | 'SIMULATE_ROUTING_RULE'
  /**
   * CASE-002 (T1): a rule whose JDM could not be evaluated was SKIPPED rather
   * than aborting case creation. Not a user action — it is the only durable
   * trail for an unusable rule while this module has no logger port. Pending
   * confirmation with the team (design open point: "Enums de EventType/Action
   * ... confirmar los nombres exactos").
   */
  | 'ROUTING_RULE_EVALUATION_FAILED'
  /**
   * A rule matched and resolved a target, but that target does not belong
   * to the organization or is not `ACTIVE` (deleted/suspended/disabled
   * user, or a role that is not assignable). Same "skip, don't assign,
   * don't abort case creation" treatment as `ROUTING_RULE_EVALUATION_FAILED`
   * — the difference is WHAT failed: the JDM ran fine, the target it
   * pointed to just cannot receive a case.
   */
  | 'ROUTING_RULE_TARGET_INVALID'
  /**
   * DLQ-001: a platform operator manually replayed a dead-lettered event
   * back onto `outbox_events`. Audited with `originalDlqId` and
   * `newOutboxId` so the trail is complete even if the requeued event
   * publishes successfully and the new outbox row is deleted.
   */
  | 'DLQ_REQUEUED'
  /**
   * Catalog mutations for `customer_webhook_subscriptions`. Deactivate is
   * UPDATE, not DELETE. Read paths are not audited.
   */
  | 'CREATE_WEBHOOK_SUBSCRIPTION'
  | 'UPDATE_WEBHOOK_SUBSCRIPTION'
  | 'DELETE_WEBHOOK_SUBSCRIPTION'
  /**
   * PUT `/organization-fraud-config` singleton upsert. One action for create
   * and re-upsert. GET is not audited.
   */
  | 'UPSERT_ORGANIZATION_FRAUD_CONFIG';

export type CaseManagementAuditResource =
  | 'case'
  | 'entity'
  | 'user'
  | 'rule'
  | 'investigation'
  | 'report'
  | 'evidence'
  | 'enforcement_action'
  /**
   * DLQ-001: a `dead_letter_queue` row (backed by the `OutboxDlqRepository`
   * port). Added so `AuditEvent.resource` typechecks for `DLQ_REQUEUED`
   * emissions (D6). Read paths (list, inspect) are not audited.
   */
  | 'dlq_event'
  /**
   * Catalog row in `customer_webhook_subscriptions`. Mutation-only
   * (CREATE/UPDATE/DELETE); list/get are not audited.
   */
  | 'webhook_subscription'
  /**
   * Per-tenant singleton in `organization_fraud_config`. Mutation-only
   * (PUT upsert); GET is not audited.
   */
  | 'organization_fraud_config';

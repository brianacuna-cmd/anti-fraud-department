import type { Db } from 'mongodb';

/**
 * Provisions uniqueness and lookup indexes. Collection and field keys are
 * snake_case; index NAMES stay snake_case so `duplicateKey.ts` can translate
 * E11000 by index name. `createIndex` is idempotent — safe on every bootstrap.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection('organizations').createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' });

  await db.collection('organizations').createIndex(
    { email: 1 },
    {
      unique: true,
      name: 'organization_email_unique',
      partialFilterExpression: { email: { $exists: true, $type: 'string' } },
    },
  );

  await db
    .collection('users')
    .createIndex({ organization_id: 1, email: 1 }, { unique: true, name: 'user_email_unique' });

  await db.collection('users').createIndex({ organization_id: 1, status: 1 }, { name: 'user_status_idx' });

  await db
    .collection('admin_organizations')
    .createIndex({ email: 1 }, { unique: true, name: 'admin_organization_email_unique' });

  await db.collection('admin_organizations').createIndex({ 'keys.key_id': 1 }, { name: 'admin_organization_keys_key_id_idx' });

  await db.collection('sessions').createIndex({ token_hash: 1 }, { unique: true, name: 'session_token_hash_unique' });

  await db
    .collection('sessions')
    .createIndex({ expira_en: 1, deleted_at: 1 }, { name: 'idx_expired_active' });

  await db
    .collection('mfa_challenges')
    .createIndex({ expires_at: 1 }, { name: 'mfa_challenge_expires_at_ttl_idx', expireAfterSeconds: 0 });

  await db
    .collection('admin_challenges')
    .createIndex({ expires_at: 1 }, { name: 'admin_challenge_expires_at_ttl_idx', expireAfterSeconds: 0 });

  await db
    .collection('audit_logs')
    .createIndex({ organization_id: 1, created_at: -1 }, { name: 'audit_log_organization_created_idx' });

  await db
    .collection('audit_logs')
    .createIndex({ actor_type: 1, actor_id: 1, created_at: -1 }, { name: 'audit_log_actor_created_idx' });

  await db.collection('audit_logs').createIndex({ action: 1, created_at: -1 }, { name: 'audit_log_action_created_idx' });

  await db.collection('notification_preferences').createIndex(
    { organization_id: 1, user_id: 1, alert_type: 1, channel: 1 },
    { unique: true, name: 'notification_preference_user_alert_channel_unique' },
  );

  await db.collection('notifications').createIndex(
    { organization_id: 1, recipient_user_id: 1, created_at: -1 },
    { name: 'notification_recipient_created_idx' },
  );

  await db.collection('cases').createIndex({ organization_id: 1, status: 1 }, { name: 'case_org_status_idx' });

  await db.collection('cases').createIndex({ organization_id: 1, priority: 1 }, { name: 'case_org_priority_idx' });

  await db.collection('cases').createIndex({ assigned_to: 1 }, { name: 'case_assigned_to_idx' });

  await db.collection('cases').createIndex({ risk_score: 1 }, { name: 'case_risk_score_idx' });

  await db.collection('cases').createIndex({ due_date: 1 }, { name: 'case_due_date_idx' });

  await db.collection('cases').createIndex({ tags: 1 }, { name: 'case_tags_idx' });

  await db
    .collection('organization_fraud_config')
    .createIndex({ organization_id: 1 }, { unique: true, name: 'org_fraud_config_unique' });

  await db
    .collection('case_timeline')
    .createIndex({ case_id: 1, created_at: -1 }, { name: 'case_timeline_case_created_idx' });

  await db
    .collection('case_notes')
    .createIndex({ case_id: 1, created_at: 1 }, { name: 'case_notes_case_created_idx' });

  await db
    .collection('resolutions')
    .createIndex({ case_id: 1, created_at: 1 }, { name: 'resolutions_case_created_idx' });

  await db
    .collection('investigations')
    .createIndex({ case_id: 1, created_at: 1 }, { name: 'investigations_case_created_idx' });

  await db
    .collection('case_reports')
    .createIndex({ case_id: 1, created_at: -1 }, { name: 'case_reports_case_created_idx' });

  await db
    .collection('evidence')
    .createIndex({ case_id: 1, created_at: -1 }, { name: 'evidence_case_created_idx' });

  await db.collection('case_sla_tracking').createIndex({ case_id: 1 }, { unique: true, name: 'sla_tracking_case_unique' });

  await db.collection('case_sla_tracking').createIndex({ due_date: 1 }, { name: 'sla_tracking_due_date_idx' });

  await db.collection('case_sla_tracking').createIndex({ status: 1 }, { name: 'sla_tracking_status_idx' });

  await db
    .collection('case_routing_rules')
    .createIndex({ organization_id: 1, status: 1 }, { name: 'case_routing_rules_org_status_idx' });

  await db
    .collection('analyst_decisions')
    .createIndex({ case_id: 1, created_at: -1 }, { name: 'analyst_decisions_case_created_idx' });

  await db
    .collection('enforcement_actions')
    .createIndex({ case_id: 1, status: 1 }, { name: 'enforcement_actions_case_status_idx' });

  await db
    .collection('enforcement_actions')
    .createIndex({ organization_id: 1, status: 1 }, { name: 'enforcement_actions_org_status_idx' });

  await db
    .collection('approval_requests')
    .createIndex({ enforcement_action_id: 1 }, { name: 'approval_requests_action_idx' });

  await db
    .collection('customer_outgoing_events')
    .createIndex({ status: 1, last_attempt_at: 1 }, { name: 'customer_outgoing_events_poll_idx' });

  await db
    .collection('customer_outgoing_events')
    .createIndex({ enforcement_action_id: 1 }, { name: 'customer_outgoing_events_action_idx' });

  // Unique ACTIVE per organization. Create before dropping the legacy
  // non-unique org+status index so duplicates fail closed (E11000) rather
  // than leaving the collection without a usable constraint.
  await db.collection('risk_scoring_rules').createIndex(
    { organization_id: 1 },
    {
      unique: true,
      name: 'risk_scoring_rules_org_active_unique',
      partialFilterExpression: { status: 'ACTIVE' },
    },
  );

  const scoringIndexes = await db.collection('risk_scoring_rules').indexes();
  if (scoringIndexes.some((index) => index.name === 'risk_scoring_rules_org_status_idx')) {
    await db.collection('risk_scoring_rules').dropIndex('risk_scoring_rules_org_status_idx');
  }

  await db.collection('organization_inbound_webhook_secrets').createIndex(
    { organization_id: 1, provider: 1 },
    { unique: true, name: 'inbound_webhook_secret_org_provider_unique' },
  );

  await db.collection('provider_ingest_events').createIndex(
    { organization_id: 1, provider: 1, provider_event_id: 1 },
    { unique: true, name: 'provider_ingest_event_org_provider_event_unique' },
  );
}

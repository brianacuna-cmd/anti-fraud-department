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

  await db.collection('case_sla_tracking').createIndex({ case_id: 1 }, { unique: true, name: 'sla_tracking_case_unique' });

  await db.collection('case_sla_tracking').createIndex({ due_date: 1 }, { name: 'sla_tracking_due_date_idx' });

  await db.collection('case_sla_tracking').createIndex({ status: 1 }, { name: 'sla_tracking_status_idx' });

  await db
    .collection('case_routing_rules')
    .createIndex({ organization_id: 1, status: 1 }, { name: 'case_routing_rules_org_status_idx' });

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
}

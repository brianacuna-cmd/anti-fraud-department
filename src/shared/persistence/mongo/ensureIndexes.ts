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

  // Entity graph (INV-013) and ingest deduplication (CASE-011): both look up
  // cases by identifier within a tenant. Graph expansion runs one query PER
  // ROUND, so without these indexes each hop is a full scan of `cases` and
  // the cost multiplies by the requested depth.
  //
  // They are compounded with `organization_id` first because no query looks
  // up an identifier without scoping the tenant: isolation is not optional.
  await db
    .collection('cases')
    .createIndex({ organization_id: 1, customer_id: 1 }, { name: 'case_org_customer_idx' });

  await db
    .collection('cases')
    .createIndex({ organization_id: 1, customer_email: 1 }, { name: 'case_org_email_idx' });

  await db
    .collection('cases')
    .createIndex({ organization_id: 1, bridge_wallet: 1 }, { name: 'case_org_wallet_idx' });

  await db
    .collection('cases')
    .createIndex({ organization_id: 1, bridge_user_id: 1 }, { name: 'case_org_bridge_user_idx' });

  await db
    .collection('cases')
    .createIndex({ organization_id: 1, stripe_customer_id: 1 }, { name: 'case_org_stripe_customer_idx' });

  // Governance dashboard (`GET /metrics/overview`): the daily-created series
  // walks `cases` by tenant and creation date. Without this index, every
  // dashboard open is a full collection scan.
  await db
    .collection('cases')
    .createIndex({ organization_id: 1, created_at: 1 }, { name: 'case_org_created_idx' });

  // The same series, on the closures side.
  await db
    .collection('resolutions')
    .createIndex({ organization_id: 1, created_at: 1 }, { name: 'resolutions_org_created_idx' });

  // case-create-idempotency (Slice 1, RF-3/RF-4): unique PARTIAL index so a
  // duplicate CreateCase call with the same (organization_id, idempotency_key)
  // fails closed (E11000) — excludes the majority null-key Cases via
  // $exists + $type:'string' (mirrors organization_email_unique).
  await db.collection('cases').createIndex(
    { organization_id: 1, idempotency_key: 1 },
    {
      unique: true,
      name: 'case_org_idempotency_key_unique',
      partialFilterExpression: { idempotency_key: { $exists: true, $type: 'string' } },
    },
  );

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

  // outbox_events (transactional outbox): relay polling of undelivered rows,
  // distributed lock leasing, chronological order per aggregate, and TTL
  // cleanup of published rows.
  await db.collection('outbox_events').createIndex(
    { status: 1, next_retry_at: 1, created_at: 1 },
    { name: 'outbox_status_retry_created_idx', partialFilterExpression: { status: { $in: ['PENDING', 'FAILED'] } } },
  );
  await db.collection('outbox_events').createIndex(
    { status: 1, locked_until: 1 },
    { name: 'outbox_status_locked_idx' },
  );
  await db.collection('outbox_events').createIndex(
    { aggregate_id: 1, created_at: 1 },
    { name: 'outbox_aggregate_created_idx' },
  );
  await db.collection('outbox_events').createIndex(
    { published_at: 1 },
    { name: 'outbox_published_ttl_idx', expireAfterSeconds: 604800, partialFilterExpression: { status: 'PUBLISHED' } },
  );

  // watchlist_entries (screening): blocking-layer lookups for the
  // non-Atlas fallback candidate repository (RF-2) — compound status
  // filter, exact document/wallet lookups, and phonetic/normalized-name
  // blocking.
  await db
    .collection('watchlist_entries')
    .createIndex({ watchlist_id: 1, status: 1 }, { name: 'watchlist_entries_watchlist_status_idx' });

  await db.collection('watchlist_entries').createIndex({ document: 1 }, { name: 'watchlist_entries_document_idx' });

  await db
    .collection('watchlist_entries')
    .createIndex({ phonetic_keys: 1 }, { name: 'watchlist_entries_phonetic_keys_idx' });

  await db
    .collection('watchlist_entries')
    .createIndex({ normalized_name: 1 }, { name: 'watchlist_entries_normalized_name_idx' });

  const watchlistIndexes = await db.collection('watchlist_entries').indexes();
  for (const obsolete of [
    'watchlist_entries_watchlist_estado_idx',
    'watchlist_entries_documento_idx',
    'watchlist_entries_nombre_normalizado_idx',
  ]) {
    if (watchlistIndexes.some((index) => index.name === obsolete)) {
      await db.collection('watchlist_entries').dropIndex(obsolete);
    }
  }

  await db
    .collection('watchlist_entries')
    .createIndex({ wallet_address: 1 }, { name: 'watchlist_entries_wallet_address_idx' });

  // aml_alerts (screening): lookups by organization/status/created_at,
  // organization/severity, organization/matched watchlist, and
  // organization/customer, plus the natural-key idempotency unique index
  // (RF-6) so outbox redelivery never creates a duplicate alert.
  // (Slice 2, NF-3) The compound org+status+created_at index supersedes the
  // narrower org+status index (status-only queries still use its prefix),
  // and also serves the newest-first sort + status+date-range queries.
  await db
    .collection('aml_alerts')
    .createIndex(
      { organization_id: 1, status: 1, created_at: -1 },
      { name: 'aml_alert_org_status_created_idx' },
    );

  await db
    .collection('aml_alerts')
    .createIndex({ organization_id: 1, severity: 1 }, { name: 'aml_alert_org_severity_idx' });

  const amlAlertIndexes = await db.collection('aml_alerts').indexes();
  for (const obsolete of [
    'aml_alert_org_estado_idx',
    'aml_alert_org_estado_created_idx',
    'aml_alert_org_severidad_idx',
  ]) {
    if (amlAlertIndexes.some((index) => index.name === obsolete)) {
      await db.collection('aml_alerts').dropIndex(obsolete);
    }
  }

  await db
    .collection('aml_alerts')
    .createIndex(
      { organization_id: 1, 'matched_entry.watchlist_id': 1 },
      { name: 'aml_alert_org_watchlist_idx' },
    );

  await db
    .collection('aml_alerts')
    .createIndex({ organization_id: 1, customer_id: 1 }, { name: 'aml_alert_org_customer_idx' });

  await db.collection('aml_alerts').createIndex(
    {
      organization_id: 1,
      customer_id: 1,
      'matched_entry.entry_id': 1,
      'matched_entry.match_field': 1,
    },
    { unique: true, name: 'aml_alerts_natural_key_unique' },
  );

  // watchlists (screening, Slice A2, design §7 / ADR-5): list queries filter
  // by org+status and org+type; the unique partial index on org+name where
  // deleted_at is null enforces per-org name uniqueness among non-deleted
  // watchlists only, allowing the same name to be reused after a soft-delete.
  await db
    .collection('watchlists')
    .createIndex({ organization_id: 1, status: 1 }, { name: 'watchlists_org_status_idx' });

  await db
    .collection('watchlists')
    .createIndex({ organization_id: 1, type: 1 }, { name: 'watchlists_org_type_idx' });

  await db.collection('watchlists').createIndex(
    { organization_id: 1, name: 1 },
    {
      unique: true,
      name: 'watchlists_org_name_partial_unique',
      partialFilterExpression: { deleted_at: null },
    },
  );

  // organization_screening_config (screening, design D-6): per-tenant
  // singleton of confidence thresholds — one document per organization.
  await db
    .collection('organization_screening_config')
    .createIndex({ organization_id: 1 }, { unique: true, name: 'org_screening_config_unique' });

  // bulk_screening_jobs (Slice A, design D7, RNF-BS-1): org-scoped status
  // polling (GET /bulk-screening-jobs/:id) and org-scoped listing by creation
  // date. Both are compounded with organization_id first for tenant isolation.
  await db
    .collection('bulk_screening_jobs')
    .createIndex({ organization_id: 1, status: 1 }, { name: 'bulk_screening_jobs_org_status_idx' });

  await db
    .collection('bulk_screening_jobs')
    .createIndex(
      { organization_id: 1, created_at: -1 },
      { name: 'bulk_screening_jobs_org_created_idx' },
    );

  // watchlist_entries (wallet-rescreen, PR2, D7): compound ESR index for the
  // keyset delta scan — equality on org+type+status, range on updated_at.
  // `watchlist_id: {$in:[...]}` stays a residual filter; BLACKLIST is the
  // dominant subset so selectivity loss from omitting it from the key is small.
  await db
    .collection('watchlist_entries')
    .createIndex(
      { organization_id: 1, entry_type: 1, status: 1, updated_at: 1 },
      { name: 'watchlist_entries_org_type_status_updated_idx' },
    );

  // screening_watermarks (wallet-rescreen, PR2, D2): unique per (org, job_name)
  // enforces the per-job singleton; last-write-wins upsert relies on this key.
  await db
    .collection('screening_watermarks')
    .createIndex(
      { organization_id: 1, job_name: 1 },
      { unique: true, name: 'screening_watermark_org_job_unique' },
    );
}

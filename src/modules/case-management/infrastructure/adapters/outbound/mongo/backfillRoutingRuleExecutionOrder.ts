import type { Db } from 'mongodb';
import type { CaseRoutingRuleDocument } from './documents/CaseRoutingRuleDocument.js';

const COLLECTION_NAME = 'case_routing_rules';

/**
 * Idempotent bootstrap: documents missing `execution_order` receive
 * `0..n-1` per organization in `created_at` ASC. Does not bump `updated_at`.
 * Safe when every org is empty or already backfilled.
 */
export async function backfillRoutingRuleExecutionOrder(db: Db): Promise<void> {
  const collection = db.collection<CaseRoutingRuleDocument>(COLLECTION_NAME);
  const missing = await collection.find({ execution_order: { $exists: false } }).toArray();
  if (missing.length === 0) {
    return;
  }

  const byOrganization = new Map<string, CaseRoutingRuleDocument[]>();
  for (const document of missing) {
    const key = document.organization_id.toString();
    const group = byOrganization.get(key) ?? [];
    group.push(document);
    byOrganization.set(key, group);
  }

  const operations = [...byOrganization.values()].flatMap((group) => {
    const ordered = [...group].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    return ordered.map((document, index) => ({
      updateOne: {
        filter: { _id: document._id },
        update: { $set: { execution_order: index } },
      },
    }));
  });

  await collection.bulkWrite(operations);
}

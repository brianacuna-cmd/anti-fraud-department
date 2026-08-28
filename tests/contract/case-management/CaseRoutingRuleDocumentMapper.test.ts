import { ObjectId } from 'mongodb';
import { oid } from '../../support/oid.js';
import { fromDate, toDate } from '../../../src/shared/time/Instant.js';
import { CaseRoutingRule } from '../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import {
  toDocument,
  toDomain,
} from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/mappers/CaseRoutingRuleDocumentMapper.js';
import type { CaseRoutingRuleDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/CaseRoutingRuleDocument.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildRule(executionOrder = 3): CaseRoutingRule {
  return CaseRoutingRule.create({
    id: generateCaseRoutingRuleId(),
    organizationId: oid('org-1'),
    name: 'high-risk',
    conditions: { nodes: [] },
    conditionsVersion: 2,
    executionOrder,
    now: NOW,
  });
}

describe('CaseRoutingRuleDocumentMapper', () => {
  it('round-trips executionOrder through toDocument and toDomain', () => {
    const rule = buildRule(5);

    const document = toDocument(rule);
    expect(document.execution_order).toBe(5);

    const rehydrated = toDomain(document);
    expect(rehydrated.executionOrder).toBe(5);
    expect(rehydrated.name).toBe('high-risk');
    expect(rehydrated.conditionsVersion).toBe(2);
  });

  it('defaults missing execution_order to 0', () => {
    const legacy = {
      _id: new ObjectId(oid('rule-legacy')),
      organization_id: new ObjectId(oid('org-1')),
      name: 'legacy',
      conditions: { nodes: [] },
      conditions_version: 1,
      target_role_id: null,
      target_user_id: null,
      status: 'INACTIVE',
      created_at: toDate(NOW),
      updated_at: toDate(NOW),
    } as CaseRoutingRuleDocument;

    expect(toDomain(legacy).executionOrder).toBe(0);
  });
});

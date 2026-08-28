import type {
  CaseManagementAuditAction,
  CaseManagementAuditResource,
} from '../../../../../src/modules/case-management/domain/model/value-objects/CaseManagementAuditVocabulary.js';

describe('CaseManagementAuditVocabulary', () => {
  it('accepts UPSERT_ORGANIZATION_FRAUD_CONFIG as a closed action', () => {
    const action: CaseManagementAuditAction = 'UPSERT_ORGANIZATION_FRAUD_CONFIG';
    expect(action).toBe('UPSERT_ORGANIZATION_FRAUD_CONFIG');
  });

  it('accepts organization_fraud_config as a closed resource', () => {
    const resource: CaseManagementAuditResource = 'organization_fraud_config';
    expect(resource).toBe('organization_fraud_config');
  });

  it('accepts UPDATE_ROUTING_RULE as a closed action', () => {
    const action: CaseManagementAuditAction = 'UPDATE_ROUTING_RULE';
    expect(action).toBe('UPDATE_ROUTING_RULE');
  });

  it('accepts REORDER_ROUTING_RULES as a closed action', () => {
    const action: CaseManagementAuditAction = 'REORDER_ROUTING_RULES';
    expect(action).toBe('REORDER_ROUTING_RULES');
  });
});

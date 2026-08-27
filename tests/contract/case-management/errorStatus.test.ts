import { caseManagementErrorStatus } from '../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import {
  caseNotFound,
  forbiddenRole,
  selfApprovalForbidden,
} from '../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import type { CaseManagementErrorCode } from '../../../src/modules/case-management/domain/errors/CaseManagementErrorCode.js';

describe('caseManagementErrorStatus', () => {
  it('maps every closed case-management error code to its HTTP status', () => {
    expect(caseManagementErrorStatus).toEqual({
      INVARIANT_VIOLATION: 400,
      INVALID_TRANSITION: 422,
      FORBIDDEN_CROSS_TENANT: 403,
      FORBIDDEN_ROLE: 403,
      ORGANIZATION_FRAUD_CONFIG_NOT_FOUND: 404,
      CASE_NOT_FOUND: 404,
      ENFORCEMENT_ACTION_NOT_FOUND: 404,
      ROUTING_RULE_NOT_FOUND: 404,
      INVESTIGATION_NOT_FOUND: 404,
      CASE_REPORT_NOT_FOUND: 404,
      EVIDENCE_NOT_FOUND: 404,
      CASE_NOTE_NOT_FOUND: 404,
      APPROVAL_REQUEST_NOT_FOUND: 404,
      SELF_APPROVAL_FORBIDDEN: 403,
      EVIDENCE_INFECTED: 422,
      CASE_NOT_ASSIGNED: 409,
      CASE_CLOSED: 409,
      CASE_INTAKE_NOT_CONFIGURED: 409,
      ASSIGNEE_CANNOT_WORK_CASES: 422,
    });
  });

  it('caseNotFound factory produces CASE_NOT_FOUND with the case id', () => {
    const error = caseNotFound('case-abc');
    expect(error.code).toBe('CASE_NOT_FOUND' satisfies CaseManagementErrorCode);
    expect(error.message).toContain('case-abc');
    expect(error.metadata).toEqual({ caseId: 'case-abc' });
  });

  /**
   * Cuatro ojos: no es un 403 de rol. El supervisor que pidio la medida TIENE
   * permiso para aprobar — lo que falla es que sea la suya. Codigo propio para
   * que quien lo recibe entienda que le falta otra persona, no un permiso.
   */
  it('selfApprovalForbidden is its own code, not a role failure', () => {
    const error = selfApprovalForbidden('analyst-1', 'approval-1');
    expect(error.code).toBe('SELF_APPROVAL_FORBIDDEN' satisfies CaseManagementErrorCode);
    expect(error.metadata).toEqual({ requesterId: 'analyst-1', approvalRequestId: 'approval-1' });
  });

  it('forbiddenRole factory produces FORBIDDEN_ROLE with role metadata', () => {
    const error = forbiddenRole('ANALYST', ['SUPERVISOR', 'ADMIN']);
    expect(error.code).toBe('FORBIDDEN_ROLE' satisfies CaseManagementErrorCode);
    expect(error.message).toContain('ANALYST');
    expect(error.metadata).toEqual({
      roleId: 'ANALYST',
      allowed: ['SUPERVISOR', 'ADMIN'],
    });
  });
});

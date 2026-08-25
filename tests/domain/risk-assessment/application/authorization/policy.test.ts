import { oid } from '../../../../support/oid.js';
import { createAuthContext } from '../../../../../src/shared/kernel/AuthContext.js';
import {
  requireOperationalRole,
  requireReadRole,
  SCORING_RULE_READ_ROLES,
  SCORING_RULE_WRITE_ROLES,
} from '../../../../../src/modules/risk-assessment/application/authorization/policy.js';
import { RiskAssessmentError } from '../../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';

const ORG = oid('org-1');

function user(roleId: string | null) {
  return createAuthContext({ userId: oid('user-1'), organizationId: ORG, actorType: 'USER', roleId });
}

const ORGANIZATION = createAuthContext({
  userId: ORG,
  organizationId: ORG,
  actorType: 'ORGANIZATION',
  roleId: null,
});

function expectForbidden(run: () => void): RiskAssessmentError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RiskAssessmentError);
    expect((error as RiskAssessmentError).code).toBe('FORBIDDEN_ROLE');
    return error as RiskAssessmentError;
  }
  throw new Error('expected the guard to throw');
}

describe('scoring rule policy', () => {
  it('lets SUPERVISOR draft and activate rules', () => {
    expect(() => requireOperationalRole(user('SUPERVISOR'), SCORING_RULE_WRITE_ROLES)).not.toThrow();
  });

  /**
   * Una regla de scoring decide que clientes acaban en la bandeja: es una
   * palanca operativa, no una preferencia de configuracion. ADMIN la lee.
   */
  it('rejects ADMIN on writes but allows it on reads', () => {
    const error = expectForbidden(() => requireOperationalRole(user('ADMIN'), SCORING_RULE_WRITE_ROLES));
    expect(error.metadata).toMatchObject({ actor: 'ADMIN', readOnly: true });

    expect(() => requireReadRole(user('ADMIN'), SCORING_RULE_READ_ROLES)).not.toThrow();
  });

  it('rejects the ORGANIZATION actor on writes but allows it on reads', () => {
    expectForbidden(() => requireOperationalRole(ORGANIZATION, SCORING_RULE_WRITE_ROLES));
    expect(() => requireReadRole(ORGANIZATION, SCORING_RULE_READ_ROLES)).not.toThrow();
  });

  it('rejects ANALYST on both planes', () => {
    expectForbidden(() => requireOperationalRole(user('ANALYST'), SCORING_RULE_WRITE_ROLES));
    expectForbidden(() => requireReadRole(user('ANALYST'), SCORING_RULE_READ_ROLES));
  });
});

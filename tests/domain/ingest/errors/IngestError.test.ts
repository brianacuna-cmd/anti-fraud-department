import {
  IngestError,
  invariantViolation,
  forbiddenRole,
  webhookSignatureInvalid,
  webhookSecretNotFound,
  forbiddenCrossTenant,
} from '../../../../src/modules/ingest/domain/errors/IngestError.js';

describe('IngestError factories', () => {
  it('invariantViolation produces INVARIANT_VIOLATION with the given message/metadata', () => {
    const error = invariantViolation('bad input', { value: 'x' });

    expect(error).toBeInstanceOf(IngestError);
    expect(error.code).toBe('INVARIANT_VIOLATION');
    expect(error.message).toBe('bad input');
    expect(error.metadata).toEqual({ value: 'x' });
  });

  it('forbiddenRole produces FORBIDDEN_ROLE with role metadata', () => {
    const error = forbiddenRole('AUDITOR', ['SUPERVISOR', 'ADMIN']);

    expect(error).toBeInstanceOf(IngestError);
    expect(error.code).toBe('FORBIDDEN_ROLE');
    expect(error.message).toBe('role "AUDITOR" is not authorized for this operation');
    expect(error.metadata).toEqual({ roleId: 'AUDITOR', allowed: ['SUPERVISOR', 'ADMIN'] });
  });

  it('forbiddenRole treats a null role as "null" in the message', () => {
    const error = forbiddenRole(null, ['SUPERVISOR']);

    expect(error.code).toBe('FORBIDDEN_ROLE');
    expect(error.message).toBe('role "null" is not authorized for this operation');
    expect(error.metadata).toEqual({ roleId: null, allowed: ['SUPERVISOR'] });
  });

  it('webhookSignatureInvalid produces WEBHOOK_SIGNATURE_INVALID', () => {
    const error = webhookSignatureInvalid();

    expect(error).toBeInstanceOf(IngestError);
    expect(error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(error.message).toBe('webhook signature is missing or invalid');
  });

  it('webhookSecretNotFound produces WEBHOOK_SECRET_NOT_FOUND for the org/provider pair', () => {
    const error = webhookSecretNotFound('org-1', 'stripe');

    expect(error).toBeInstanceOf(IngestError);
    expect(error.code).toBe('WEBHOOK_SECRET_NOT_FOUND');
    expect(error.message).toBe('no inbound webhook secret exists for organization "org-1" provider "stripe"');
    expect(error.metadata).toEqual({ organizationId: 'org-1', provider: 'stripe' });
  });

  it('forbiddenCrossTenant produces FORBIDDEN_CROSS_TENANT', () => {
    const error = forbiddenCrossTenant();

    expect(error).toBeInstanceOf(IngestError);
    expect(error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });
});

import { DomainError } from '../../../../src/shared/kernel/DomainError.js';
import {
  IdentityAccessError,
  invariantViolation,
  invalidTransition,
  forbiddenReactivation,
  forbiddenCrossTenant,
  organizationSlugTaken,
  organizationNotFound,
  userEmailTaken,
  userNotFound,
} from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

describe('IdentityAccessError', () => {
  it('is a DomainError carrying one of the closed identity-access codes', () => {
    const error = new IdentityAccessError('ORGANIZATION_NOT_FOUND', 'organization "org-1" not found', {
      id: 'org-1',
    });

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('ORGANIZATION_NOT_FOUND');
    expect(error.message).toBe('organization "org-1" not found');
    expect(error.metadata).toEqual({ id: 'org-1' });
  });
});

describe('invariantViolation', () => {
  it('builds an INVARIANT_VIOLATION error carrying the given message and metadata', () => {
    const error = invariantViolation('Slug must be a non-empty string', { value: '' });

    expect(error.code).toBe('INVARIANT_VIOLATION');
    expect(error.message).toBe('Slug must be a non-empty string');
    expect(error.metadata).toEqual({ value: '' });
  });
});

describe('invalidTransition', () => {
  it('builds an INVALID_TRANSITION error naming both statuses', () => {
    const error = invalidTransition('INACTIVO', 'INACTIVO');

    expect(error.code).toBe('INVALID_TRANSITION');
    expect(error.metadata).toEqual({ current: 'INACTIVO', next: 'INACTIVO' });
  });
});

describe('forbiddenReactivation', () => {
  it('builds a FORBIDDEN_REACTIVATION error naming both statuses', () => {
    const error = forbiddenReactivation('DESHABILITADO', 'ACTIVO');

    expect(error.code).toBe('FORBIDDEN_REACTIVATION');
    expect(error.metadata).toEqual({ current: 'DESHABILITADO', next: 'ACTIVO' });
  });
});

describe('forbiddenCrossTenant', () => {
  it('defaults to a generic cross-tenant message when none is given', () => {
    const error = forbiddenCrossTenant();

    expect(error.code).toBe('FORBIDDEN_CROSS_TENANT');
    expect(error.message.length).toBeGreaterThan(0);
  });
});

describe('organizationSlugTaken', () => {
  it('carries the taken slug in metadata', () => {
    const error = organizationSlugTaken('acme');

    expect(error.code).toBe('ORGANIZATION_SLUG_TAKEN');
    expect(error.metadata).toEqual({ slug: 'acme' });
  });
});

describe('organizationNotFound', () => {
  it('carries the missing id in metadata', () => {
    const error = organizationNotFound('org-404');

    expect(error.code).toBe('ORGANIZATION_NOT_FOUND');
    expect(error.metadata).toEqual({ id: 'org-404' });
  });
});

describe('userEmailTaken', () => {
  it('carries the taken email in metadata', () => {
    const error = userEmailTaken('a@b.com');

    expect(error.code).toBe('USER_EMAIL_TAKEN');
    expect(error.metadata).toEqual({ email: 'a@b.com' });
  });
});

describe('userNotFound', () => {
  it('carries the missing id in metadata', () => {
    const error = userNotFound('user-404');

    expect(error.code).toBe('USER_NOT_FOUND');
    expect(error.metadata).toEqual({ id: 'user-404' });
  });
});

import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type Email = Brand<string, 'Email'>;

/**
 * Deliberately simple format guard (local@domain, no spaces) — full RFC 5322
 * validation is not this slice's concern; uniqueness (org-scoped for regular
 * users, cross-tenant for the bootstrap admin) is enforced by the
 * application layer against the repository, not here.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createEmail(value: string): Email {
  if (!EMAIL_PATTERN.test(value)) {
    throw invariantViolation('Email must be a valid address (local@domain)', { value });
  }
  return brand<string, 'Email'>(value);
}

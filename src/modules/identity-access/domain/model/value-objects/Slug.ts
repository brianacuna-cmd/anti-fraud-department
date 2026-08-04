import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type Slug = Brand<string, 'Slug'>;

/**
 * Lowercase letters, digits, and single internal hyphens only — no leading,
 * trailing, or repeated hyphens. Immutable once an organization is created
 * (organization-lifecycle spec: "Organization Identity Patch").
 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function createSlug(value: string): Slug {
  if (!SLUG_PATTERN.test(value)) {
    throw invariantViolation(
      'Slug must be lowercase letters, digits, and single internal hyphens only',
      { value },
    );
  }
  return brand<string, 'Slug'>(value);
}

import { invariantViolation } from '../../errors/SarError.js';

/**
 * A postal address as the filing schema wants it.
 *
 * `state` is two letters only for US addresses — FinCEN's state element is a
 * US-state enumeration, and a foreign province does not belong in it. The
 * country carries the distinction, so a non-US address leaves `state` null
 * rather than stuffing a province where a validator expects `CA`.
 */
export interface PostalAddress {
  readonly street: string;
  readonly city: string;
  readonly state: string | null;
  readonly postalCode: string;
  /** ISO 3166-1 alpha-2. */
  readonly country: string;
}

export function createPostalAddress(input: {
  street: string;
  city: string;
  state?: string | null;
  postalCode: string;
  country: string;
}): PostalAddress {
  assertNonEmpty('street', input.street);
  assertNonEmpty('city', input.city);
  assertNonEmpty('postalCode', input.postalCode);
  const country = input.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw invariantViolation('PostalAddress country must be an ISO 3166-1 alpha-2 code', {
      country: input.country,
    });
  }
  const state = input.state === undefined || input.state === null ? null : input.state.trim().toUpperCase();
  if (country === 'US' && (state === null || !/^[A-Z]{2}$/.test(state))) {
    throw invariantViolation('a US PostalAddress needs a two-letter state code', { state: input.state });
  }
  return {
    street: input.street.trim(),
    city: input.city.trim(),
    state,
    postalCode: input.postalCode.trim(),
    country,
  };
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`PostalAddress ${field} must be a non-empty string`, { field });
  }
}

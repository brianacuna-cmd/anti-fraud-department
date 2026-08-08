/**
 * Duplicated from `identity-access`'s `ActorType` value object (design
 * D-A9) — the `audit` module cannot import another module's domain types
 * (eslint `boundaries`), so it carries its own copy of this closed union.
 */
export type ActorType = 'USER' | 'ORGANIZATION' | 'PLATFORM_ADMIN';

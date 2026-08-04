declare const __brand: unique symbol;

/**
 * Nominal typing helper. Two `Brand<string, 'A'>` and `Brand<string, 'B'>`
 * values are structurally identical strings at runtime but incompatible
 * types at compile time — used for `OrganizationId`, `UserId`, `Instant`,
 * etc. so the compiler rejects passing one branded ID where another is
 * expected, even though both are plain strings underneath.
 */
export type Brand<T, TBrand extends string> = T & {
  readonly [__brand]: TBrand;
};

/**
 * Applies a brand to a raw value. Purely a compile-time cast — the runtime
 * value is returned unchanged (identity function).
 */
export function brand<T, TBrand extends string>(value: T): Brand<T, TBrand> {
  return value as Brand<T, TBrand>;
}

/**
 * `talisman` ships no type declarations and resolves as plain CommonJS with
 * no `exports` map, so NodeNext resolution finds the modules at runtime but
 * `tsc` cannot infer their shape (TS7016). These ambient declarations are
 * scoped to exactly the three entry points the matching adapters import —
 * kept local to `infrastructure/adapters/outbound/matching` so a future
 * talisman major version bump only needs updating here.
 */
declare module 'talisman/phonetics/double-metaphone.js' {
  export default function doubleMetaphone(token: string): [string, string];
}

declare module 'talisman/metrics/jaro-winkler.js' {
  export default function jaroWinkler(a: string, b: string): number;
}

declare module 'talisman/metrics/levenshtein.js' {
  export default function levenshtein(a: string, b: string): number;
}

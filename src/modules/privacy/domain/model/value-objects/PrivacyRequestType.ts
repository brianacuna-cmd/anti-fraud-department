import { invariantViolation } from '../../errors/PrivacyError.js';

/**
 * The five rights a data subject can exercise (GDPR arts. 15-21; the Spanish
 * and Latin-American "ARCO+P" set maps one-to-one onto these).
 *
 * They are modeled as a closed catalog and NOT as free text because the type
 * decides two things that cannot be decided later: the clock that starts
 * running, and whether the request can even be satisfied without breaking a
 * retention duty. A request whose type is a string nobody validated is a
 * request nobody can prove was handled correctly.
 */
export type PrivacyRequestType =
  /** Art. 15 — what do you hold about me. */
  | 'ACCESS'
  /** Art. 16 — this is wrong, fix it. */
  | 'RECTIFICATION'
  /** Art. 17 — delete it. The one that collides with AML retention. */
  | 'ERASURE'
  /** Art. 21 — stop processing it for this purpose. */
  | 'OBJECTION'
  /** Art. 20 — hand it to me in a machine-readable form. */
  | 'PORTABILITY';

export const PRIVACY_REQUEST_TYPES = [
  'ACCESS',
  'RECTIFICATION',
  'ERASURE',
  'OBJECTION',
  'PORTABILITY',
] as const;

const VALID: ReadonlySet<string> = new Set<PrivacyRequestType>(PRIVACY_REQUEST_TYPES);

export function createPrivacyRequestType(value: string): PrivacyRequestType {
  if (!VALID.has(value)) {
    throw invariantViolation(`unknown privacy request type "${value}"`, {
      value,
      allowed: [...PRIVACY_REQUEST_TYPES],
    });
  }
  return value as PrivacyRequestType;
}

/**
 * Types whose fulfilment means handing data BACK to the subject, as opposed
 * to changing or removing it. Both produce an export package; the difference
 * is that portability requires a machine-readable format and access does not.
 */
export function producesExport(type: PrivacyRequestType): boolean {
  return type === 'ACCESS' || type === 'PORTABILITY';
}

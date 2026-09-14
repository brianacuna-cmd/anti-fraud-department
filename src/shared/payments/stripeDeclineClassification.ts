/**
 * Groups Stripe's many decline/failure codes into the handful of categories a
 * fraud analyst actually reasons about. Lives in `shared` because two modules
 * read it: ingest (as a risk signal on `charge.failed`) and case-management
 * (to label the charges of a connected account in the Stripe view).
 *
 * WHY THE CATEGORIES MATTER
 *
 * "Declined" alone says nothing. An insufficient-funds decline is a normal
 * customer; a stolen-card decline or a run of CVC failures is exactly what
 * card testing looks like. Rules and the case file need that difference.
 */
export type DeclineCategory =
  /** The issuer or Radar suspects fraud: stolen/lost card, blocked by risk, velocity rules. */
  | 'FRAUD_SUSPECTED'
  /** Verification failed: CVC, PIN, postal code, 3DS. Repeated, a card-testing pattern. */
  | 'AUTHENTICATION_FAILED'
  /** No money or over a limit. Usually a legitimate customer. */
  | 'INSUFFICIENT_FUNDS'
  /** Wrong, expired or unsupported card data. */
  | 'INVALID_CARD'
  /** The issuer said no without saying why (generic, do not honor, not permitted…). */
  | 'ISSUER_DECLINED'
  /** Transient problem on the network or the issuer side. */
  | 'TECHNICAL_ERROR'
  /** A code this table does not know yet. */
  | 'UNKNOWN';

export interface DeclineClassification {
  /** The code that decided the category, or the first code seen when none is known. */
  readonly code: string | null;
  readonly category: DeclineCategory;
}

const CATEGORY_BY_CODE: Readonly<Record<string, DeclineCategory>> = {
  // Fraud suspected by the issuer or by Radar.
  fraudulent: 'FRAUD_SUSPECTED',
  stolen_card: 'FRAUD_SUSPECTED',
  lost_card: 'FRAUD_SUSPECTED',
  pickup_card: 'FRAUD_SUSPECTED',
  merchant_blacklist: 'FRAUD_SUSPECTED',
  restricted_card: 'FRAUD_SUSPECTED',
  security_violation: 'FRAUD_SUSPECTED',
  highest_risk_level: 'FRAUD_SUSPECTED',
  elevated_risk_level: 'FRAUD_SUSPECTED',
  rule: 'FRAUD_SUSPECTED',
  blocked: 'FRAUD_SUSPECTED',

  // Verification.
  authentication_required: 'AUTHENTICATION_FAILED',
  incorrect_cvc: 'AUTHENTICATION_FAILED',
  invalid_cvc: 'AUTHENTICATION_FAILED',
  incorrect_pin: 'AUTHENTICATION_FAILED',
  invalid_pin: 'AUTHENTICATION_FAILED',
  pin_try_exceeded: 'AUTHENTICATION_FAILED',
  offline_pin_required: 'AUTHENTICATION_FAILED',
  online_or_offline_pin_required: 'AUTHENTICATION_FAILED',
  incorrect_zip: 'AUTHENTICATION_FAILED',

  // Funds and limits.
  insufficient_funds: 'INSUFFICIENT_FUNDS',
  card_velocity_exceeded: 'INSUFFICIENT_FUNDS',
  withdrawal_count_limit_exceeded: 'INSUFFICIENT_FUNDS',

  // Card data.
  expired_card: 'INVALID_CARD',
  incorrect_number: 'INVALID_CARD',
  invalid_number: 'INVALID_CARD',
  invalid_expiry_month: 'INVALID_CARD',
  invalid_expiry_year: 'INVALID_CARD',
  invalid_account: 'INVALID_CARD',
  card_not_supported: 'INVALID_CARD',
  currency_not_supported: 'INVALID_CARD',
  new_account_information_available: 'INVALID_CARD',

  // Issuer said no.
  card_declined: 'ISSUER_DECLINED',
  issuer_declined: 'ISSUER_DECLINED',
  generic_decline: 'ISSUER_DECLINED',
  do_not_honor: 'ISSUER_DECLINED',
  do_not_try_again: 'ISSUER_DECLINED',
  call_issuer: 'ISSUER_DECLINED',
  no_action_taken: 'ISSUER_DECLINED',
  not_permitted: 'ISSUER_DECLINED',
  service_not_allowed: 'ISSUER_DECLINED',
  transaction_not_allowed: 'ISSUER_DECLINED',
  revocation_of_all_authorizations: 'ISSUER_DECLINED',
  revocation_of_authorization: 'ISSUER_DECLINED',
  stop_payment_order: 'ISSUER_DECLINED',
  invalid_amount: 'ISSUER_DECLINED',
  duplicate_transaction: 'ISSUER_DECLINED',
  approve_with_id: 'ISSUER_DECLINED',
  testmode_decline: 'ISSUER_DECLINED',
  low_probability_of_authorization: 'ISSUER_DECLINED',

  // Transient.
  processing_error: 'TECHNICAL_ERROR',
  try_again_later: 'TECHNICAL_ERROR',
  issuer_not_available: 'TECHNICAL_ERROR',
  reenter_transaction: 'TECHNICAL_ERROR',
  card_decline_rate_limit_exceeded: 'TECHNICAL_ERROR',
};

/**
 * Classifies the codes of ONE charge. Pass them most specific first — the
 * decline code (`outcome.reason` / `outcome.network_decline_code`), then
 * `failure_code`, then `outcome.type` — because Stripe often sends a generic
 * `card_declined` next to the precise reason, and the precise one must win.
 *
 * Returns `null` when the charge carries no code at all (it did not fail).
 */
export function classifyStripeDecline(codes: readonly (string | null | undefined)[]): DeclineClassification | null {
  const present = codes.filter((code): code is string => typeof code === 'string' && code.trim().length > 0);
  if (present.length === 0) {
    return null;
  }
  for (const code of present) {
    const key = code.trim().toLowerCase();
    // `hasOwn`, not a plain lookup: a code like "constructor" must not hit Object.prototype.
    if (Object.hasOwn(CATEGORY_BY_CODE, key)) {
      return { code: code.trim(), category: CATEGORY_BY_CODE[key]! };
    }
  }
  return { code: present[0]!.trim(), category: 'UNKNOWN' };
}

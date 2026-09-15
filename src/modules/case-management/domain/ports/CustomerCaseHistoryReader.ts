/** How many cases a customer already had, by state and closure outcome. */
export interface CustomerCaseHistory {
  readonly previousCases: number;
  /** OPEN, IN_REVIEW or PENDING_DOCUMENTATION. */
  readonly openCases: number;
  readonly fraudConfirmedCases: number;
  readonly falsePositiveCases: number;
}

export interface CustomerCaseHistoryQuery {
  readonly organizationId: string;
  /** Matched against `customerId`, `stripeCustomerId` and `bridgeUserId`: the event may carry any of them. */
  readonly customerId: string;
  /** Other ids of the same person (Bridge, Stripe, Finturu); their cases count too. */
  readonly alsoKnownAs?: readonly string[];
  /** The case being looked at, left out so it does not count as its own history. */
  readonly excludeCaseId?: string;
}

/**
 * Read model over `cases`. Soft-deleted cases never count. Outcomes only
 * exist on cases resolved since closure outcomes were introduced; older
 * resolved cases count in `previousCases` and in neither outcome bucket.
 */
export interface CustomerCaseHistoryReader {
  countByCustomer(query: CustomerCaseHistoryQuery): Promise<CustomerCaseHistory>;
}

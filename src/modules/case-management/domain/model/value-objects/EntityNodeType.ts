import { invariantViolation } from '../../errors/CaseManagementError.js';

/**
 * The identifiers by which two cases may turn out to be the same network.
 *
 * This is not `InvestigationSubjectType` enlarged for convenience. That one
 * is the catalog of what an analyst can *choose* to investigate (WALLET,
 * EMAIL, CUSTOMER); this is what ingestion knows how to *normalize* from
 * Finturu, and they are different things: `BRIDGE_USER` and `STRIPE_CUSTOMER`
 * connect cases with far more precision than an email —they are provider
 * keys, not text the fraudster types— but nobody would open an investigation
 * "about a Stripe id". Mixing them would force one of the two to admit
 * values that do not belong to it.
 */
export type EntityNodeType = 'CUSTOMER' | 'EMAIL' | 'WALLET' | 'BRIDGE_USER' | 'STRIPE_CUSTOMER';

export const ENTITY_NODE_TYPES = [
  'CUSTOMER',
  'EMAIL',
  'WALLET',
  'BRIDGE_USER',
  'STRIPE_CUSTOMER',
] as const;

const VALID: ReadonlySet<string> = new Set<EntityNodeType>(ENTITY_NODE_TYPES);

export function createEntityNodeType(value: string): EntityNodeType {
  if (!VALID.has(value)) {
    throw invariantViolation(`EntityNodeType must be one of ${ENTITY_NODE_TYPES.join(', ')}`, { value });
  }
  return value as EntityNodeType;
}

/**
 * Translates an investigation's subject type to the graph node from which
 * expansion should start pulling.
 *
 * The map is total over `InvestigationSubjectType` on purpose: if tomorrow
 * the subject catalog grows, the `switch` stops compiling and someone has to
 * decide by which identifier it expands, instead of the new investigation
 * returning an empty graph without anyone noticing.
 */
export function entityNodeTypeForSubject(subjectType: 'WALLET' | 'EMAIL' | 'CUSTOMER'): EntityNodeType {
  switch (subjectType) {
    case 'WALLET':
      return 'WALLET';
    case 'EMAIL':
      return 'EMAIL';
    case 'CUSTOMER':
      return 'CUSTOMER';
  }
}

/**
 * Canonical form of an identifier, so two writings of the same data land on
 * the same node.
 *
 * Email is lowercased because `Fraude@X.com` and `fraude@x.com` are the same
 * mailbox and whoever opens accounts in series knows it. The rest is only
 * trimmed: an EVM wallet is written in checksum-case on purpose (EIP-55) and
 * a Bridge or Stripe id is opaque, so lowercasing them would invent an
 * equivalence the provider does not guarantee.
 */
export function normalizeEntityValue(type: EntityNodeType, value: string): string {
  const trimmed = value.trim();
  return type === 'EMAIL' ? trimmed.toLowerCase() : trimmed;
}

/** Stable `TYPE:value` key, to de-duplicate nodes and as the id in the output JSON. */
export function entityNodeKey(type: EntityNodeType, value: string): string {
  return `${type}:${normalizeEntityValue(type, value)}`;
}

/**
 * A concrete identifier: the type and its already-canonicalized value.
 *
 * Lives here and not next to the graph engine because `CaseRepository` uses
 * it in the `findByEntityIdentifiers` signature, and a domain port cannot
 * depend on a domain service without inverting the relationship.
 */
export interface EntityRef {
  readonly type: EntityNodeType;
  readonly value: string;
}

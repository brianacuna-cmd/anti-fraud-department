import { ObjectId, type Collection, type Db } from 'mongodb';
import type { Clock } from '../shared/time/Clock.js';
import { toDate } from '../shared/time/Instant.js';
import {
  FinturuUnavailableError,
  type FinturuApiClient,
  type FinturuIdentityQuery,
} from '../modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';

/**
 * Every id one person is known by, from any one of them: the Finturu user id,
 * the Bridge customer id, the Stripe Connect account and the platform Stripe
 * customer. Always includes the id asked for, and never throws: a scoring run
 * must not fail because Finturu is slow, it just counts under that single id.
 */
export type ResolveCustomerIds = (organizationId: string, customerId: string) => Promise<readonly string[]>;

export const CUSTOMER_IDENTITY_LINKS_COLLECTION = 'customer_identity_links';

/** A known person changes ids rarely; an unknown id may become known (a new Bridge customer). */
export const IDENTITY_TTL_MS = 24 * 3_600_000;
export const UNKNOWN_IDENTITY_TTL_MS = 3_600_000;

interface IdentityLinkDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  /** Every id of the person; the id that was asked for is always among them. */
  readonly ids: readonly string[];
  readonly known: boolean;
  readonly expires_at: Date;
}

export interface CustomerIdentityResolverDeps {
  readonly finturu: Pick<FinturuApiClient, 'getIdentity'>;
  readonly db: Db;
  readonly clock: Clock;
  readonly onError?: (error: unknown) => void;
}

/**
 * Resolves through api-business and caches the answer in Mongo per
 * organization. The provider id prefix says what kind of id it is: `acct_`
 * Connect account, `cus_` Stripe customer, digits a Finturu user, anything
 * else a Bridge customer.
 */
export function createCustomerIdentityResolver(deps: CustomerIdentityResolverDeps): ResolveCustomerIds {
  const links: Collection<IdentityLinkDocument> = deps.db.collection(CUSTOMER_IDENTITY_LINKS_COLLECTION);

  return async function resolveCustomerIds(organizationId, customerId) {
    const id = customerId.trim();
    if (id.length === 0) return [customerId];
    const now = toDate(deps.clock.now());
    const organization = new ObjectId(organizationId);

    const cached = await links.findOne({ organization_id: organization, ids: id, expires_at: { $gt: now } });
    if (cached !== null) return cached.ids.includes(id) ? cached.ids : [id, ...cached.ids];

    let identity;
    try {
      identity = (await deps.finturu.getIdentity(queryFor(id))).identity;
    } catch (error) {
      if (!(error instanceof FinturuUnavailableError)) throw error;
      deps.onError?.(error);
      return [id];
    }

    const ids = identity === null
      ? [id]
      : unique([
          id,
          String(identity.userId),
          identity.bridgeCustomerId,
          identity.stripeAccountId,
          identity.stripeCustomerId,
        ]);
    const ttl = identity === null ? UNKNOWN_IDENTITY_TTL_MS : IDENTITY_TTL_MS;
    await links.updateOne(
      { organization_id: organization, ids: id },
      { $set: { ids, known: identity !== null, expires_at: new Date(now.getTime() + ttl) } },
      { upsert: true },
    );
    return ids;
  };
}

export function queryFor(id: string): FinturuIdentityQuery {
  if (id.startsWith('acct_')) return { stripeAccountId: id };
  if (id.startsWith('cus_')) return { stripeCustomerId: id };
  if (/^\d+$/.test(id)) return { userId: Number(id) };
  return { bridgeCustomerId: id };
}

function unique(ids: readonly (string | null)[]): string[] {
  return [...new Set(ids.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

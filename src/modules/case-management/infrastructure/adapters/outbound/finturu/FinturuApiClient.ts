import { decryptFinturuPayload, isEncryptedPayload } from '../../inbound/http/FinturuPayloadDecryptor.js';

export interface FinturuCustomerDto {
  readonly idUserBridge?: string;
  /** Present when Bridge already has the Stripe customer linked. */
  readonly idCustomer?: string;
  readonly idUser?: string;
  readonly name?: string;
  readonly lastname?: string;
  readonly email?: string;
  readonly status?: string;
  readonly type?: string;
  readonly phone?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface FinturuWalletDto {
  readonly idWallet?: string;
  readonly customerId?: string;
  readonly chain?: string;
  readonly address?: string;
  readonly balances?: readonly { readonly currency: string; readonly balance: string }[];
}

export interface FinturuTransferDto {
  readonly idTransfer?: string;
  readonly clientReferenceId?: string;
  readonly amount?: string | number;
  readonly currency?: string;
  readonly onBehalfOf?: string;
  readonly source?: Record<string, unknown>;
  readonly destination?: Record<string, unknown>;
  readonly receipt?: Record<string, unknown>;
  readonly state?: string;
}

export interface FinturuStripeCustomerDto {
  readonly idCustomer?: string;
  /** Stripe returns the identifier as `id` on some endpoints. */
  readonly id?: string;
  readonly name?: string;
  readonly email?: string;
  readonly balance?: number;
  readonly currency?: string;
  /** Cross-correlation: Finturu stores `idUser`/`idUserBridge` here. */
  readonly metadata?: Record<string, unknown> | null;
}

export interface FinturuStripeTransferDto {
  readonly idTransfer?: string;
  readonly customerId?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly status?: string;
}

/** Payment link figures of a merchant (api-business `MerchantService`). Amounts in USD. */
export interface FinturuMerchantDto {
  readonly userId: number;
  readonly name: string;
  readonly email: string | null;
  readonly createdAt: string | null;
  readonly companyName: string | null;
  readonly companyCountry: string | null;
  readonly stripeAccountId: string | null;
  readonly stripeAccountStatus: string | null;
  readonly stripeAccountRisk: string | null;
  readonly links: {
    readonly total: number;
    readonly paid: number;
    readonly refused: number;
    readonly expired: number;
    readonly refunded: number;
    readonly paidAmount: number;
    readonly refundedAmount: number;
    readonly firstLinkAt: string | null;
    readonly lastLinkAt: string | null;
  };
}

export interface FinturuPaymentLinkDto {
  readonly id: number;
  readonly userId: number | null;
  readonly description: string | null;
  readonly amount: number;
  readonly shippingAmount: number;
  readonly fee: number | null;
  readonly currency: string;
  readonly state: string | null;
  readonly isPaid: boolean;
  readonly provider: string | null;
  readonly providerPaymentId: string | null;
  readonly reference: string | null;
  readonly orderId: string | null;
  readonly refundAmount: number | null;
  readonly refundDate: string | null;
  readonly createdAt: string | null;
  readonly dueDate: string | null;
}

/** A merchant's Stripe charges in a period (api-business `listReconciliationCharges`). Cents. */
export interface FinturuReconciliationChargesDto {
  readonly userId: number;
  /** `null`: the merchant has no Stripe Connect account. */
  readonly providerId: string | null;
  readonly items: readonly {
    readonly chargeId: string;
    readonly paymentIntentId: string | null;
    readonly amountCents: number;
    readonly amountRefundedCents: number;
    readonly currency: string;
    readonly status: string;
    readonly paid: boolean;
    readonly disputed: boolean;
    readonly createdAt: string;
  }[];
  readonly truncated: boolean;
}

/** Every id of one Finturu customer (api-business `IdentityService`). */
export interface FinturuIdentityDto {
  readonly userId: number;
  readonly email: string | null;
  readonly bridgeCustomerId: string | null;
  readonly stripeAccountId: string | null;
  readonly stripeCustomerId: string | null;
}

/** Exactly one of them. */
export type FinturuIdentityQuery =
  | { readonly userId: number }
  | { readonly bridgeCustomerId: string }
  | { readonly stripeAccountId: string }
  | { readonly stripeCustomerId: string };

export interface FinturuPage<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/**
 * The Finturu API did not answer, or answered with an error. Only the STRICT
 * reads throw it: reports built on Finturu data must fail loudly, because an
 * empty answer would read as "no links", and a reconciliation over no links
 * says everything is fine.
 */
export class FinturuUnavailableError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
  ) {
    super(`Finturu API unavailable for ${path}${status === null ? '' : ` (HTTP ${status})`}`);
    this.name = 'FinturuUnavailableError';
  }
}

export interface FinturuApiClientOptions {
  readonly baseUrl: string;
  readonly encryptionKey?: string;
  /** Cuts the request off if the Finturu API does not respond. Default 10 s. */
  readonly timeoutMs?: number;
}

export class FinturuApiClient {
  private readonly baseUrl: string;
  private readonly encryptionKey?: string;
  private readonly timeoutMs: number;

  constructor(options: FinturuApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.encryptionKey = options.encryptionKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private normalizeUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    if (this.baseUrl.includes('/fraud-department')) {
      return `${this.baseUrl}${cleanPath}`;
    }
    return `${this.baseUrl}/api/v1/fraud-department${cleanPath}`;
  }

  /**
   * Never propagates the failure: a down Finturu API degrades the reply to
   * `fallback` instead of taking the endpoint down. Silent on purpose — most
   * failures here are expected 404s for data a customer simply doesn't have
   * (virtual accounts, ACH history) — and cuts at `timeoutMs`: without that
   * cutoff a route that does not respond leaves the request hanging
   * indefinitely and the frontend spinning forever.
   *
   * `fallback` is a parameter because `[]` lies on the listings that do not
   * exist upstream yet: a 404 showed on screen as a "0" as confident as a real
   * zero. Those pass `null` so they can say "not available" instead.
   */
  private async fetchEndpoint<T>(path: string, fallback: T = [] as unknown as T): Promise<T> {
    const url = this.normalizeUrl(path);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        return fallback;
      }

      const body = await res.json();
      if (isEncryptedPayload(body)) {
        if (!this.encryptionKey) {
          return fallback;
        }
        return decryptFinturuPayload(body, this.encryptionKey) as T;
      }
      return body as T;
    } catch {
      return fallback;
    }
  }

  /** Like `fetchEndpoint` but never degrades: any failure throws `FinturuUnavailableError`. */
  private async fetchStrict<T>(path: string, timeoutMs: number = this.timeoutMs): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.normalizeUrl(path), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new FinturuUnavailableError(path, null);
    }
    if (res.status === 404) {
      throw new FinturuUnavailableError(path, 404);
    }
    if (!res.ok) {
      throw new FinturuUnavailableError(path, res.status);
    }
    const body = await res.json();
    if (isEncryptedPayload(body)) {
      if (!this.encryptionKey) {
        throw new FinturuUnavailableError(path, null);
      }
      return decryptFinturuPayload(body, this.encryptionKey) as T;
    }
    return body as T;
  }

  async listMerchants(limit: number, offset: number, search?: string): Promise<FinturuPage<FinturuMerchantDto>> {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (search) query.set('search', search);
    return this.fetchStrict<FinturuPage<FinturuMerchantDto>>(`/merchants?${query.toString()}`);
  }

  /** `null` when Finturu has no such merchant (404); other failures throw. */
  async getMerchant(userId: number): Promise<FinturuMerchantDto | null> {
    try {
      return await this.fetchStrict<FinturuMerchantDto>(`/merchant/${userId}`);
    } catch (error) {
      if (error instanceof FinturuUnavailableError && error.status === 404) return null;
      throw error;
    }
  }

  async listPaymentLinks(query: {
    readonly userId?: number;
    readonly from?: string;
    readonly to?: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<FinturuPage<FinturuPaymentLinkDto>> {
    const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) });
    if (query.userId !== undefined) params.set('userId', String(query.userId));
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    return this.fetchStrict<FinturuPage<FinturuPaymentLinkDto>>(`/payment-links?${params.toString()}`);
  }

  /**
   * The merchant's Stripe charges created in the period, fetched live from
   * Stripe by api-business. Walking a busy account takes several Stripe pages,
   * so it gets a longer cut than the other reads.
   */
  async listStripeReconciliationCharges(query: {
    readonly userId: number;
    readonly from: string;
    readonly to: string;
  }): Promise<FinturuReconciliationChargesDto> {
    const params = new URLSearchParams({ userId: String(query.userId), from: query.from, to: query.to });
    return this.fetchStrict<FinturuReconciliationChargesDto>(`/stripe/reconciliation-charges?${params.toString()}`, 60_000);
  }

  /** `identity: null` when nobody in Finturu has that id; any failure throws. */
  async getIdentity(query: FinturuIdentityQuery): Promise<{ readonly identity: FinturuIdentityDto | null }> {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    return this.fetchStrict<{ identity: FinturuIdentityDto | null }>(`/identity?${params.toString()}`);
  }

  /** Stripe events (platform and Connect) created after `since` (Unix seconds), raw. */
  async getStripeEventFeed(sinceUnixSeconds: number): Promise<{
    readonly items: readonly Record<string, unknown>[];
    readonly until: number;
    readonly truncated: boolean;
  }> {
    return this.fetchStrict(`/feeds/stripe-events?since=${sinceUnixSeconds}`, 120_000);
  }

  /** Raw Bridge transfers updated after `since`, among those created after `createdAfter`. */
  async getBridgeTransferFeed(sinceIso: string, createdAfterIso: string): Promise<{
    readonly items: readonly Record<string, unknown>[];
    readonly until: string;
    readonly truncated: boolean;
  }> {
    const params = new URLSearchParams({ since: sinceIso, createdAfter: createdAfterIso });
    return this.fetchStrict(`/feeds/bridge-transfers?${params.toString()}`, 180_000);
  }

  async getCustomers(): Promise<readonly FinturuCustomerDto[]> {
    const res = await this.fetchEndpoint<unknown>('/customers');
    return Array.isArray(res) ? (res as FinturuCustomerDto[]) : [];
  }

  /**
   * One page of customers instead of the full directory. Bridge latency is
   * proportional to page size, so asking for 10 takes ~2 s versus the more
   * than two minutes it takes to walk the whole thing.
   */
  async getCustomersPage(
    limit: number,
    startingAfter?: string,
  ): Promise<{ data: readonly FinturuCustomerDto[]; nextCursor: string | null }> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (startingAfter) query.set('starting_after', startingAfter);

    const res = await this.fetchEndpoint<Record<string, unknown>>(`/customers/page?${query.toString()}`);

    return {
      data: Array.isArray(res?.data) ? (res.data as FinturuCustomerDto[]) : [],
      nextCursor: typeof res?.nextCursor === 'string' ? res.nextCursor : null,
    };
  }

  async getCustomer(idUserBridge: string): Promise<Record<string, unknown> | null> {
    const res = await this.fetchEndpoint<Record<string, unknown>>(`/customer/${encodeURIComponent(idUserBridge)}`);
    return res && typeof res === 'object' && !Array.isArray(res) ? res : null;
  }

  async getWallets(): Promise<readonly FinturuWalletDto[]> {
    const res = await this.fetchEndpoint<unknown>('/wallets');
    return Array.isArray(res) ? (res as FinturuWalletDto[]) : [];
  }

  async getUserWallets(idUserBridge: string): Promise<readonly FinturuWalletDto[]> {
    const res = await this.fetchEndpoint<unknown>(`/wallet-user/${encodeURIComponent(idUserBridge)}`);
    return Array.isArray(res) ? (res as FinturuWalletDto[]) : [];
  }

  async getWallet(walletBridge: string): Promise<Record<string, unknown> | null> {
    const res = await this.fetchEndpoint<Record<string, unknown>>(`/wallet/${encodeURIComponent(walletBridge)}`);
    return res && typeof res === 'object' && !Array.isArray(res) ? res : null;
  }

  async getWalletHistory(walletBridge: string): Promise<readonly unknown[]> {
    const res = await this.fetchEndpoint<unknown>(`/wallet-history/${encodeURIComponent(walletBridge)}`);
    return Array.isArray(res) ? res : [];
  }

  async getTransfers(): Promise<readonly FinturuTransferDto[]> {
    const res = await this.fetchEndpoint<unknown>('/transfers');
    return Array.isArray(res) ? (res as FinturuTransferDto[]) : [];
  }

  async getTransfer(idTransfer: string): Promise<Record<string, unknown> | null> {
    const res = await this.fetchEndpoint<Record<string, unknown>>(`/transfer/${encodeURIComponent(idTransfer)}`);
    return res && typeof res === 'object' && !Array.isArray(res) ? res : null;
  }

  async getExternalAccounts(idUserBridge: string): Promise<readonly unknown[]> {
    const res = await this.fetchEndpoint<unknown>(`/external-accounts/${encodeURIComponent(idUserBridge)}`);
    return Array.isArray(res) ? res : [];
  }

  /**
   * `null` = could not be queried. Finturu currently has the virtual-accounts
   * and ACH-history routes commented out (they answer 404), and returning `[]`
   * painted them as "this customer has none" — a claim nobody verified. The
   * panel tells that `null` apart and shows "Not available".
   */
  async getVirtualAccounts(idUserBridge: string): Promise<readonly unknown[] | null> {
    const res = await this.fetchEndpoint<unknown>(`/customer/${encodeURIComponent(idUserBridge)}/virtual-accounts`, null);
    return Array.isArray(res) ? res : null;
  }

  async getAchHistory(idUserBridge: string): Promise<readonly unknown[] | null> {
    const res = await this.fetchEndpoint<unknown>(`/customer/${encodeURIComponent(idUserBridge)}/ach-history`, null);
    return Array.isArray(res) ? res : null;
  }

  async getCustomerBridgeTransfers(idUserBridge: string): Promise<readonly unknown[]> {
    const res = await this.fetchEndpoint<unknown>(`/customer/${encodeURIComponent(idUserBridge)}/transfers`);
    return Array.isArray(res) ? res : [];
  }

  async getCustomerFinturuTransfers(idUserBridge: string): Promise<readonly unknown[]> {
    const res = await this.fetchEndpoint<unknown>(`/customer/${encodeURIComponent(idUserBridge)}/finturu-transfers`);
    return Array.isArray(res) ? res : [];
  }

  async getStripeCustomers(): Promise<readonly FinturuStripeCustomerDto[]> {
    const res = await this.fetchEndpoint<unknown>('/stripe/customers');
    return Array.isArray(res) ? (res as FinturuStripeCustomerDto[]) : [];
  }

  async getStripeCustomer(idCustomer: string): Promise<Record<string, unknown> | null> {
    const res = await this.fetchEndpoint<Record<string, unknown>>(`/stripe/customer/${encodeURIComponent(idCustomer)}`);
    return res && typeof res === 'object' && !Array.isArray(res) ? res : null;
  }

  async getStripeCustomerByEmail(email: string): Promise<Record<string, unknown> | null> {
    const res = await this.fetchEndpoint<Record<string, unknown>>(`/stripe/customer-by-email?email=${encodeURIComponent(email)}`);
    return res && typeof res === 'object' && !Array.isArray(res) ? res : null;
  }

  async getStripeTransfers(): Promise<readonly FinturuStripeTransferDto[]> {
    const res = await this.fetchEndpoint<unknown>('/stripe/transfers');
    return Array.isArray(res) ? (res as FinturuStripeTransferDto[]) : [];
  }

  async getStripeConnectedAccounts(
    limit: number,
    offset: number,
  ): Promise<{ items: readonly Record<string, unknown>[]; total: number }> {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const res = await this.fetchEndpoint<Record<string, unknown>>(`/stripe/connected-accounts?${query.toString()}`);
    return {
      items: Array.isArray(res?.items) ? (res.items as Record<string, unknown>[]) : [],
      total: typeof res?.total === 'number' ? res.total : 0,
    };
  }

  /**
   * El endpoint responde `{ connectAccount, platformCustomer }`, no la
   * cuenta pelada: sin desenvolver, un objeto `{ connectAccount: null, ... }`
   * es igual de "verdadero" que uno con cuenta real, y el panel mostraba
   * "Habilitada" para cualquier cliente cuya consulta respondiera bien,
   * tuviera o no cuenta Stripe.
   */
  async getStripeConnectedAccount(idUserBridge: string): Promise<Record<string, unknown> | null> {
    const res = await this.fetchEndpoint<Record<string, unknown>>(
      `/stripe/connected-account?idUserBridge=${encodeURIComponent(idUserBridge)}`,
    );
    const connectAccount = res && typeof res === 'object' && !Array.isArray(res) ? res.connectAccount : null;
    return connectAccount && typeof connectAccount === 'object' && !Array.isArray(connectAccount)
      ? (connectAccount as Record<string, unknown>)
      : null;
  }

  async getStripeConnectedAccountStatus(providerId: string): Promise<Record<string, unknown> | null> {
    const res = await this.fetchEndpoint<Record<string, unknown>>(
      `/stripe/connected-account/${encodeURIComponent(providerId)}/status`,
    );
    return res && typeof res === 'object' && !Array.isArray(res) ? res : null;
  }

  async getStripeConnectedAccountBalance(providerId: string): Promise<Record<string, unknown> | null> {
    const res = await this.fetchEndpoint<Record<string, unknown>>(
      `/stripe/connected-account/${encodeURIComponent(providerId)}/balance`,
    );
    return res && typeof res === 'object' && !Array.isArray(res) ? res : null;
  }

  async getStripeConnectedAccountCharges(
    providerId: string,
    limit = 10,
    startingAfter?: string,
  ): Promise<Record<string, unknown> | null> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (startingAfter) query.set('startingAfter', startingAfter);
    const res = await this.fetchEndpoint<Record<string, unknown>>(
      `/stripe/connected-account/${encodeURIComponent(providerId)}/charges?${query.toString()}`,
    );
    return res && typeof res === 'object' && !Array.isArray(res) ? res : null;
  }

  async getStripeConnectedAccountChargeDetail(
    providerId: string,
    chargeId: string,
  ): Promise<Record<string, unknown> | null> {
    const res = await this.fetchEndpoint<Record<string, unknown>>(
      `/stripe/connected-account/${encodeURIComponent(providerId)}/charge/${encodeURIComponent(chargeId)}`,
    );
    return res && typeof res === 'object' && !Array.isArray(res) ? res : null;
  }

  private async getStripeConnectedAccountPagedList(
    resource: 'disputes' | 'fraud-warnings' | 'payouts',
    providerId: string,
    limit = 10,
    startingAfter?: string,
  ): Promise<Record<string, unknown> | null> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (startingAfter) query.set('startingAfter', startingAfter);
    const res = await this.fetchEndpoint<Record<string, unknown>>(
      `/stripe/connected-account/${encodeURIComponent(providerId)}/${resource}?${query.toString()}`,
    );
    return res && typeof res === 'object' && !Array.isArray(res) ? res : null;
  }

  async getStripeConnectedAccountDisputes(providerId: string, limit = 10, startingAfter?: string) {
    return this.getStripeConnectedAccountPagedList('disputes', providerId, limit, startingAfter);
  }

  async getStripeConnectedAccountFraudWarnings(providerId: string, limit = 10, startingAfter?: string) {
    return this.getStripeConnectedAccountPagedList('fraud-warnings', providerId, limit, startingAfter);
  }

  async getStripeConnectedAccountPayouts(providerId: string, limit = 10, startingAfter?: string) {
    return this.getStripeConnectedAccountPagedList('payouts', providerId, limit, startingAfter);
  }
}

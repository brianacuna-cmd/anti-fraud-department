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
   * empty instead of taking the endpoint down. It DOES leave a trail in the
   * log and cuts at `timeoutMs`: without that cutoff a route that does not
   * respond leaves the request hanging indefinitely and the frontend spinning
   * forever.
   */
  private async fetchEndpoint<T>(path: string): Promise<T> {
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
        console.warn(`[finturu] ${res.status} en GET ${url}`);
        return [] as unknown as T;
      }

      const body = await res.json();
      if (isEncryptedPayload(body)) {
        if (!this.encryptionKey) {
          console.warn(`[finturu] respuesta cifrada en GET ${url} pero falta FRAUD_DEPARTMENT_KEY`);
          return [] as unknown as T;
        }
        return decryptFinturuPayload(body, this.encryptionKey) as T;
      }
      return body as T;
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError'
        ? `sin respuesta en ${this.timeoutMs} ms`
        : (error as Error).message;
      console.warn(`[finturu] GET ${url} falló: ${reason}`);
      return [] as unknown as T;
    }
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

  async getVirtualAccounts(idUserBridge: string): Promise<readonly unknown[]> {
    const res = await this.fetchEndpoint<unknown>(`/customer/${encodeURIComponent(idUserBridge)}/virtual-accounts`);
    return Array.isArray(res) ? res : [];
  }

  async getAchHistory(idUserBridge: string): Promise<readonly unknown[]> {
    const res = await this.fetchEndpoint<unknown>(`/customer/${encodeURIComponent(idUserBridge)}/ach-history`);
    return Array.isArray(res) ? res : [];
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
}

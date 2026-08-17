import { decryptFinturuPayload, isEncryptedPayload } from '../../inbound/http/FinturuPayloadDecryptor.js';

export interface FinturuCustomerDto {
  readonly idUserBridge?: string;
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
  readonly name?: string;
  readonly email?: string;
  readonly balance?: number;
  readonly currency?: string;
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
}

export class FinturuApiClient {
  private readonly baseUrl: string;
  private readonly encryptionKey?: string;

  constructor(options: FinturuApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.encryptionKey = options.encryptionKey;
  }

  private normalizeUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    if (this.baseUrl.includes('/fraud-department')) {
      return `${this.baseUrl}${cleanPath}`;
    }
    return `${this.baseUrl}/api/v1/fraud-department${cleanPath}`;
  }

  private async fetchEndpoint<T>(path: string): Promise<T> {
    const url = this.normalizeUrl(path);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        return [] as unknown as T;
      }

      const body = await res.json();
      if (isEncryptedPayload(body)) {
        if (!this.encryptionKey) {
          return [] as unknown as T;
        }
        return decryptFinturuPayload(body, this.encryptionKey) as T;
      }
      return body as T;
    } catch {
      return [] as unknown as T;
    }
  }

  async getCustomers(): Promise<readonly FinturuCustomerDto[]> {
    const res = await this.fetchEndpoint<unknown>('/customers');
    return Array.isArray(res) ? (res as FinturuCustomerDto[]) : [];
  }

  async getCustomer(idUserBridge: string): Promise<Record<string, any> | null> {
    const res = await this.fetchEndpoint<Record<string, any>>(`/customer/${encodeURIComponent(idUserBridge)}`);
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

  async getWallet(walletBridge: string): Promise<Record<string, any> | null> {
    const res = await this.fetchEndpoint<Record<string, any>>(`/wallet/${encodeURIComponent(walletBridge)}`);
    return res && typeof res === 'object' ? res : null;
  }

  async getWalletHistory(walletBridge: string): Promise<readonly any[]> {
    const res = await this.fetchEndpoint<unknown>(`/wallet-history/${encodeURIComponent(walletBridge)}`);
    return Array.isArray(res) ? res : [];
  }

  async getTransfers(): Promise<readonly FinturuTransferDto[]> {
    const res = await this.fetchEndpoint<unknown>('/transfers');
    return Array.isArray(res) ? (res as FinturuTransferDto[]) : [];
  }

  async getTransfer(idTransfer: string): Promise<Record<string, any> | null> {
    const res = await this.fetchEndpoint<Record<string, any>>(`/transfer/${encodeURIComponent(idTransfer)}`);
    return res && typeof res === 'object' ? res : null;
  }

  async getExternalAccounts(idUserBridge: string): Promise<readonly any[]> {
    const res = await this.fetchEndpoint<unknown>(`/external-accounts/${encodeURIComponent(idUserBridge)}`);
    return Array.isArray(res) ? res : [];
  }

  async getVirtualAccounts(idUserBridge: string): Promise<readonly any[]> {
    const res = await this.fetchEndpoint<unknown>(`/customer/${encodeURIComponent(idUserBridge)}/virtual-accounts`);
    return Array.isArray(res) ? res : [];
  }

  async getAchHistory(idUserBridge: string): Promise<readonly any[]> {
    const res = await this.fetchEndpoint<unknown>(`/customer/${encodeURIComponent(idUserBridge)}/ach-history`);
    return Array.isArray(res) ? res : [];
  }

  async getCustomerBridgeTransfers(idUserBridge: string): Promise<readonly any[]> {
    const res = await this.fetchEndpoint<unknown>(`/customer/${encodeURIComponent(idUserBridge)}/transfers`);
    return Array.isArray(res) ? res : [];
  }

  async getCustomerFinturuTransfers(idUserBridge: string): Promise<readonly any[]> {
    const res = await this.fetchEndpoint<unknown>(`/customer/${encodeURIComponent(idUserBridge)}/finturu-transfers`);
    return Array.isArray(res) ? res : [];
  }

  async getStripeCustomers(): Promise<readonly FinturuStripeCustomerDto[]> {
    const res = await this.fetchEndpoint<unknown>('/stripe/customers');
    return Array.isArray(res) ? (res as FinturuStripeCustomerDto[]) : [];
  }

  async getStripeCustomer(idCustomer: string): Promise<Record<string, any> | null> {
    const res = await this.fetchEndpoint<Record<string, any>>(`/stripe/customer/${encodeURIComponent(idCustomer)}`);
    return res && typeof res === 'object' ? res : null;
  }

  async getStripeCustomerByEmail(email: string): Promise<Record<string, any> | null> {
    const res = await this.fetchEndpoint<Record<string, any>>(`/stripe/customer-by-email?email=${encodeURIComponent(email)}`);
    return res && typeof res === 'object' ? res : null;
  }

  async getStripeTransfers(): Promise<readonly FinturuStripeTransferDto[]> {
    const res = await this.fetchEndpoint<unknown>('/stripe/transfers');
    return Array.isArray(res) ? (res as FinturuStripeTransferDto[]) : [];
  }
}

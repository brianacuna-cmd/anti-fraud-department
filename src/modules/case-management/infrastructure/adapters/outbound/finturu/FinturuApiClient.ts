import { decryptFinturuPayload, isEncryptedPayload } from '../../inbound/http/FinturuPayloadDecryptor.js';

export interface FinturuCustomerDto {
  readonly idUserBridge?: string;
  /** Presente cuando Bridge ya trae enlazado el cliente de Stripe. */
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
  /** Stripe devuelve el identificador como `id` en algunos endpoints. */
  readonly id?: string;
  readonly name?: string;
  readonly email?: string;
  readonly balance?: number;
  readonly currency?: string;
  /** Correlacion cruzada: Finturu guarda aqui `idUser`/`idUserBridge`. */
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
  /** Corta la petición si la API de Finturu no responde. Por defecto 10 s. */
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
   * Nunca propaga el fallo: una API de Finturu caída degrada la respuesta al
   * `fallback` en lugar de tumbar el endpoint. Pero SÍ deja rastro en el log y
   * corta a los `timeoutMs`: sin ese corte una ruta que no responde deja la
   * petición colgada indefinidamente y el frontend girando para siempre.
   *
   * El `fallback` es parametrizable porque `[]` miente en los listados que hoy
   * no existen aguas arriba: un 404 se veía en pantalla como un "0" tan firme
   * como un cero real. Esos pasan `null` para poder decir "no disponible".
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
        console.warn(`[finturu] ${res.status} en GET ${url}`);
        return fallback;
      }

      const body = await res.json();
      if (isEncryptedPayload(body)) {
        if (!this.encryptionKey) {
          console.warn(`[finturu] respuesta cifrada en GET ${url} pero falta FRAUD_DEPARTMENT_KEY`);
          return fallback;
        }
        return decryptFinturuPayload(body, this.encryptionKey) as T;
      }
      return body as T;
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError'
        ? `sin respuesta en ${this.timeoutMs} ms`
        : (error as Error).message;
      console.warn(`[finturu] GET ${url} falló: ${reason}`);
      return fallback;
    }
  }

  async getCustomers(): Promise<readonly FinturuCustomerDto[]> {
    const res = await this.fetchEndpoint<unknown>('/customers');
    return Array.isArray(res) ? (res as FinturuCustomerDto[]) : [];
  }

  /**
   * Una página de clientes en lugar del padrón completo. La latencia de Bridge
   * es proporcional al tamaño de página, así que pedir 10 tarda ~2 s frente a
   * los más de dos minutos que cuesta recorrerlo entero.
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
   * `null` = no se pudo consultar. Hoy Finturu tiene comentadas las rutas de
   * cuentas virtuales y de historial ACH (responden 404), y devolver `[]` las
   * pintaba como "este cliente no tiene ninguna" — una afirmación que nadie ha
   * comprobado. El panel distingue ese `null` y muestra "No disponible".
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
}

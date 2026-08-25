import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type {
  FinturuApiClient,
  FinturuStripeCustomerDto,
  FinturuStripeTransferDto,
  FinturuTransferDto,
  FinturuWalletDto,
} from '../infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import type { createIngestFinturuCaseUseCase } from './IngestFinturuCase.js';
import type { Case } from '../domain/model/aggregates/Case.js';

export interface SyncFinturuDataInput {
  readonly auth?: AuthContext;
  readonly organizationId?: string;
}

export interface SyncFinturuDataResult {
  readonly totalSynced: number;
  readonly cases: readonly Case[];
}

export interface SyncFinturuDataDeps {
  readonly finturuClient: FinturuApiClient;
  readonly ingestFinturuCase: ReturnType<typeof createIngestFinturuCaseUseCase>;
  readonly defaultOrganizationId?: string;
}

/**
 * Reads a correlation key from an untyped object (Stripe `metadata`,
 * a transfer's `source`/`destination`). Returns `null` if missing, so the
 * caller never compares `undefined` against a Set.
 *
 * Accepts a number as well as text: Finturu's register types the SAME field
 * as a number in some payloads and as a string in others, and discarding the
 * numeric variant would leave half the customers uncorrelated.
 */
function readKey(bag: Record<string, unknown> | undefined, key: string): string | null {
  const value = bag?.[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function createSyncFinturuDataUseCase(deps: SyncFinturuDataDeps) {
  return async function syncFinturuData(input: SyncFinturuDataInput = {}): Promise<SyncFinturuDataResult> {
    const orgId = input.organizationId ?? input.auth?.organizationId ?? deps.defaultOrganizationId ?? '019d7e58aed0777318d11d4d';

    // 1. Fetch data from Finturu API in parallel
    const [customers, wallets, transfers, stripeCustomers, stripeTransfers] = await Promise.all([
      deps.finturuClient.getCustomers(),
      deps.finturuClient.getWallets(),
      deps.finturuClient.getTransfers(),
      deps.finturuClient.getStripeCustomers(),
      deps.finturuClient.getStripeTransfers(),
    ]);

    const casesCreatedOrUpdated: Case[] = [];

    // Map wallets by customerId / idUserBridge
    const walletsByUser = new Map<string, FinturuWalletDto[]>();
    for (const w of wallets) {
      const key = w.customerId ?? '';
      if (key) {
        const list = walletsByUser.get(key) ?? [];
        list.push(w);
        walletsByUser.set(key, list);
      }
    }

    // Map Stripe customers by email, idCustomer, and metadata
    const stripeByEmail = new Map<string, FinturuStripeCustomerDto>();
    const stripeByIdCustomer = new Map<string, FinturuStripeCustomerDto>();
    const stripeByIdUser = new Map<string, FinturuStripeCustomerDto>();
    const stripeByIdUserBridge = new Map<string, FinturuStripeCustomerDto>();

    for (const sc of stripeCustomers) {
      if (sc.email) stripeByEmail.set(String(sc.email).trim().toLowerCase(), sc);
      if (sc.idCustomer) stripeByIdCustomer.set(String(sc.idCustomer).trim(), sc);
      if (sc.id) stripeByIdCustomer.set(String(sc.id).trim(), sc);
      const meta = sc.metadata;
      if (meta && typeof meta === 'object') {
        for (const key of ['idUser', 'userId'] as const) {
          const value = readKey(meta, key);
          if (value) stripeByIdUser.set(value, sc);
        }
        for (const key of ['idUserBridge', 'bridgeUserId'] as const) {
          const value = readKey(meta, key);
          if (value) stripeByIdUserBridge.set(value, sc);
        }
        const metaEmail = readKey(meta, 'email');
        if (metaEmail) stripeByEmail.set(metaEmail.toLowerCase(), sc);
      }
    }

    // Map Stripe transfers by customerId
    const stripeTransfersByUser = new Map<string, FinturuStripeTransferDto[]>();
    for (const st of stripeTransfers) {
      const key = st.customerId ?? '';
      if (key) {
        const list = stripeTransfersByUser.get(key) ?? [];
        list.push(st);
        stripeTransfersByUser.set(key, list);
      }
    }

    // 2. Correlate and ingest each customer
    for (const customer of customers) {
      const bridgeUserId = customer.idUserBridge ? String(customer.idUserBridge).trim() : '';
      const email = customer.email ? String(customer.email).trim().toLowerCase() : '';
      const idUser = customer.idUser ? String(customer.idUser).trim() : '';
      const userWallets = bridgeUserId ? walletsByUser.get(bridgeUserId) ?? [] : [];
      const userWalletIds = new Set(userWallets.map((w) => w.idWallet).filter(Boolean));
      const userWalletAddresses = new Set(userWallets.map((w) => String(w.address ?? '').toLowerCase()).filter(Boolean));

      // Filter transfers strictly matching this user
      const userTransfers = transfers.filter((t: FinturuTransferDto) => {
        if (bridgeUserId && t.onBehalfOf && t.onBehalfOf === bridgeUserId) return true;

        const sourceWallet = readKey(t.source, 'bridgeWalletId');
        const destinationWallet = readKey(t.destination, 'bridgeWalletId');
        if (sourceWallet && userWalletIds.has(sourceWallet)) return true;
        if (destinationWallet && userWalletIds.has(destinationWallet)) return true;

        const fromAddress = readKey(t.source, 'fromAddress');
        const toAddress = readKey(t.destination, 'toAddress');
        if (fromAddress && userWalletAddresses.has(fromAddress.toLowerCase())) return true;
        if (toAddress && userWalletAddresses.has(toAddress.toLowerCase())) return true;

        return false;
      });

      let stripeData: FinturuStripeCustomerDto | null =
        (email ? stripeByEmail.get(email) : null) ??
        (idUser ? stripeByIdUser.get(idUser) : null) ??
        (bridgeUserId ? stripeByIdUserBridge.get(bridgeUserId) : null) ??
        null;

      // Fallback: Query Stripe directly by email if not found in list (useful for staging)
      if (!stripeData && email) {
        try {
          const directStripe = await deps.finturuClient.getStripeCustomerByEmail(email);
          if (directStripe && directStripe.idCustomer) {
            stripeData = directStripe;
          }
        } catch {
          // ignore fallback error
        }
      }

      const stripeCustomerId = stripeData?.idCustomer ?? stripeData?.id ?? customer.idCustomer ?? null;
      const stripeTransfersList = stripeCustomerId ? stripeTransfersByUser.get(stripeCustomerId) ?? [] : [];

      const primaryWallet = userWallets[0]?.address ?? '';

      // Calculate initial risk score based on transactions & status
      let calculatedRisk = 40;
      if (customer.status === 'suspended' || customer.status === 'blocked') calculatedRisk += 50;
      if (userTransfers.some((t) => t.state === 'failed' || t.state === 'returned')) calculatedRisk += 25;
      if (userTransfers.length > 5) calculatedRisk += 15;
      const riskScore = Math.min(Math.max(calculatedRisk, 10), 99);

      const consolidatedPayload = {
        organization_id: orgId,
        idUser: customer.idUser ?? customer.idUserBridge ?? `cust_${Date.now()}`,
        idUserBridge: customer.idUserBridge,
        name: customer.name,
        lastname: customer.lastname,
        email: customer.email,
        phone: customer.phone,
        status: customer.status,
        address: primaryWallet,
        idCustomer: stripeCustomerId,
        wallets: userWallets,
        transfers: userTransfers,
        stripe: stripeData ? { ...stripeData, idCustomer: stripeCustomerId, transfers: stripeTransfersList } : null,
        risk_score: riskScore,
        coinflow: null,
      };

      const result = await deps.ingestFinturuCase({
        rawPayload: consolidatedPayload,
        organizationId: orgId,
        recordTimeline: false, // Never pollute CaseTimeline during client load/sync
      });

      casesCreatedOrUpdated.push(result.case);
    }

    return {
      totalSynced: casesCreatedOrUpdated.length,
      cases: casesCreatedOrUpdated,
    };
  };
}

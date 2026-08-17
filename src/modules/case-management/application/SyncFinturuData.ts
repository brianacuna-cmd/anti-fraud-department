import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { FinturuApiClient } from '../infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
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
    const walletsByUser = new Map<string, any[]>();
    for (const w of wallets) {
      const key = w.customerId ?? '';
      if (key) {
        const list = walletsByUser.get(key) ?? [];
        list.push(w);
        walletsByUser.set(key, list);
      }
    }

    // Map Stripe customers by email / idCustomer
    const stripeByEmail = new Map<string, any>();
    for (const sc of stripeCustomers) {
      if (sc.email) stripeByEmail.set(sc.email.toLowerCase(), sc);
      if (sc.idCustomer) stripeByEmail.set(sc.idCustomer, sc);
    }

    // Map Stripe transfers by customerId
    const stripeTransfersByUser = new Map<string, any[]>();
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
      const bridgeUserId = customer.idUserBridge ?? '';
      const email = customer.email?.toLowerCase() ?? '';
      const userWallets = bridgeUserId ? walletsByUser.get(bridgeUserId) ?? [] : [];
      const userWalletIds = new Set(userWallets.map((w) => w.idWallet).filter(Boolean));
      const userWalletAddresses = new Set(userWallets.map((w) => String(w.address ?? '').toLowerCase()).filter(Boolean));

      // Filter transfers strictly matching this user
      const userTransfers = transfers.filter((t: any) => {
        if (bridgeUserId && t.onBehalfOf && t.onBehalfOf === bridgeUserId) return true;
        if (t.source?.bridgeWalletId && userWalletIds.has(t.source.bridgeWalletId)) return true;
        if (t.destination?.bridgeWalletId && userWalletIds.has(t.destination.bridgeWalletId)) return true;
        if (t.source?.fromAddress && userWalletAddresses.has(String(t.source.fromAddress).toLowerCase())) return true;
        if (t.destination?.toAddress && userWalletAddresses.has(String(t.destination.toAddress).toLowerCase())) return true;
        return false;
      });

      const stripeData = email ? stripeByEmail.get(email) ?? null : null;
      const stripeTransfersList = stripeData?.idCustomer ? stripeTransfersByUser.get(stripeData.idCustomer) ?? [] : [];

      const primaryWallet = userWallets[0]?.address ?? '';

      // Calculate initial risk score based on transactions & status
      let calculatedRisk = 40;
      if (customer.status === 'suspended' || customer.status === 'blocked') calculatedRisk += 50;
      if (userTransfers.some((t: any) => t.state === 'failed' || t.state === 'returned')) calculatedRisk += 25;
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
        idCustomer: stripeData?.idCustomer,
        wallets: userWallets,
        transfers: userTransfers,
        stripe: stripeData ? { ...stripeData, transfers: stripeTransfersList } : null,
        risk_score: riskScore,
        coinflow: null,
      };

      const result = await deps.ingestFinturuCase({
        rawPayload: consolidatedPayload,
        organizationId: orgId,
      });

      casesCreatedOrUpdated.push(result.case);
    }

    return {
      totalSynced: casesCreatedOrUpdated.length,
      cases: casesCreatedOrUpdated,
    };
  };
}

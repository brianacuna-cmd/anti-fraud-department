import type {
  FinturuApiClient,
  FinturuCustomerDto,
} from '../modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import type {
  ScreeningCustomer,
  ScreeningCustomerSource,
} from '../modules/screening/domain/ports/ScreeningCustomerSource.js';

function trimmed(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

/**
 * Maps one Finturu customer to what the name rescreen needs, or `null` when
 * there is nothing to screen.
 *
 * `customerId` follows `finturuWalletSource` exactly (`idUser`, falling back
 * to `idUserBridge`): alerts are idempotent on it, so the wallet and the name
 * rescreen must name the same customer the same way or one person ends up
 * with alerts under two identities.
 */
export function toScreeningCustomer(customer: FinturuCustomerDto): ScreeningCustomer | null {
  const bridgeUserId = trimmed(customer.idUserBridge);
  const idUser = trimmed(customer.idUser);
  const customerId = idUser.length > 0 ? idUser : bridgeUserId;
  const name = [trimmed(customer.name), trimmed(customer.lastname)].filter((part) => part.length > 0).join(' ');
  if (customerId.length === 0 || name.length === 0) return null;
  return {
    customerId,
    name,
    // Finturu creates customers as `individual` or `business` (api-business, Bridge onboarding).
    entryType: trimmed(customer.type).toLowerCase() === 'business' ? 'ORGANIZATION' : 'PERSON',
  };
}

/** Composition bridge: screening ← FinturuApiClient (eslint boundaries). */
export function createFinturuScreeningCustomerSource(
  finturuClient: Pick<FinturuApiClient, 'getCustomers'>,
): ScreeningCustomerSource {
  return {
    async *streamCustomers(): AsyncIterable<ScreeningCustomer> {
      for (const customer of await finturuClient.getCustomers()) {
        const screening = toScreeningCustomer(customer);
        if (screening !== null) yield screening;
      }
    },
  };
}

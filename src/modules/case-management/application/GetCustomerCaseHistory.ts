import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type {
  CustomerCaseHistory,
  CustomerCaseHistoryReader,
} from '../domain/ports/CustomerCaseHistoryReader.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetCustomerCaseHistoryInput {
  readonly auth: AuthContext;
  readonly customerId: string;
  readonly excludeCaseId?: string;
}

export interface GetCustomerCaseHistoryDeps {
  readonly reader: CustomerCaseHistoryReader;
}

/** Tenant-scoped case counts of one customer (scoring context and case file panel). */
export function createGetCustomerCaseHistoryUseCase(deps: GetCustomerCaseHistoryDeps) {
  return async function getCustomerCaseHistory(input: GetCustomerCaseHistoryInput): Promise<CustomerCaseHistory> {
    const organizationId = requireTenantContext(input.auth);
    return deps.reader.countByCustomer({
      organizationId,
      customerId: input.customerId,
      ...(input.excludeCaseId !== undefined ? { excludeCaseId: input.excludeCaseId } : {}),
    });
  };
}

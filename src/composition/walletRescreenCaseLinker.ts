import type { CaseRepository } from '../modules/case-management/domain/ports/CaseRepository.js';
import { ACTIVE_CASE_STATUSES } from '../modules/case-management/domain/ports/CaseRepository.js';
import type { WalletRescreenCaseLinker } from '../modules/screening/domain/ports/WalletRescreenCaseLinker.js';

/** Composition bridge: screening ← CaseRepository.findByCustomerOrBridgeId (eslint boundaries, D5). */
export function createWalletRescreenCaseLinker(cases: CaseRepository): WalletRescreenCaseLinker {
  return {
    async find(organizationId: string, customerId: string): Promise<string | null> {
      const found = await cases.findByCustomerOrBridgeId({ organizationId, customerId, statuses: ACTIVE_CASE_STATUSES });
      return found !== null ? String(found.id) : null;
    },
  };
}

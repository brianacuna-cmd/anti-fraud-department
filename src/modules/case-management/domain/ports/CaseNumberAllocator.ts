import type { Instant } from '../../../../shared/time/Instant.js';
import type { CaseNumber } from '../model/value-objects/CaseNumber.js';

/**
 * Hands out the next readable `CaseNumber` of an organization for the year of
 * `at` (UTC).
 *
 * Deliberately takes no transaction: allocating inside the case-creation
 * transaction would make every concurrent creation in the same organization
 * fight over one counter document. The cost is that an aborted creation
 * burns its number — acceptable, numbers are unique, not gapless.
 */
export interface CaseNumberAllocator {
  allocate(organizationId: string, at: Instant): Promise<CaseNumber>;
}

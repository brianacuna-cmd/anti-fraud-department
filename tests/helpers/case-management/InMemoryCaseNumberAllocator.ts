import { toDate, type Instant } from '../../../src/shared/time/Instant.js';
import { formatCaseNumber, type CaseNumber } from '../../../src/modules/case-management/domain/model/value-objects/CaseNumber.js';
import type { CaseNumberAllocator } from '../../../src/modules/case-management/domain/ports/CaseNumberAllocator.js';

/** In-memory fake: one counter per (organization, UTC year), like the Mongo adapter. */
export class InMemoryCaseNumberAllocator implements CaseNumberAllocator {
  private readonly counters = new Map<string, number>();

  async allocate(organizationId: string, at: Instant): Promise<CaseNumber> {
    const year = toDate(at).getUTCFullYear();
    const key = `${organizationId}:${year}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return formatCaseNumber(year, next);
  }
}

import type { WalletRescreenCaseLinker } from '../../../../src/modules/screening/domain/ports/WalletRescreenCaseLinker.js';
import { oid } from '../../../support/oid.js';

class FakeWalletRescreenCaseLinker implements WalletRescreenCaseLinker {
  private readonly cases: Map<string, string>;

  constructor(entries: Array<{ organizationId: string; customerId: string; caseId: string }> = []) {
    this.cases = new Map(entries.map((e) => [`${e.organizationId}::${e.customerId}`, e.caseId]));
  }

  async find(organizationId: string, customerId: string): Promise<string | null> {
    return this.cases.get(`${organizationId}::${customerId}`) ?? null;
  }
}

describe('WalletRescreenCaseLinker (port contract)', () => {
  it('find returns the caseId when an OPEN or IN_REVIEW case exists for the customer', async () => {
    const caseId = oid('case-open-1');
    const linker: WalletRescreenCaseLinker = new FakeWalletRescreenCaseLinker([
      { organizationId: oid('org-1'), customerId: oid('cust-1'), caseId },
    ]);

    const result = await linker.find(oid('org-1'), oid('cust-1'));

    expect(result).toBe(caseId);
  });

  it('find returns null when no OPEN or IN_REVIEW case exists for the customer', async () => {
    const linker: WalletRescreenCaseLinker = new FakeWalletRescreenCaseLinker([]);

    const result = await linker.find(oid('org-1'), oid('cust-no-case'));

    expect(result).toBeNull();
  });

  it('find scopes by organizationId — same customerId under a different org returns null', async () => {
    const caseId = oid('case-open-2');
    const linker: WalletRescreenCaseLinker = new FakeWalletRescreenCaseLinker([
      { organizationId: oid('org-1'), customerId: oid('cust-shared'), caseId },
    ]);

    const wrongOrg = await linker.find(oid('org-2'), oid('cust-shared'));
    const correctOrg = await linker.find(oid('org-1'), oid('cust-shared'));

    expect(wrongOrg).toBeNull();
    expect(correctOrg).toBe(caseId);
  });
});

import type { CaseRepository } from '../../src/modules/case-management/domain/ports/CaseRepository.js';
import { ACTIVE_CASE_STATUSES } from '../../src/modules/case-management/domain/ports/CaseRepository.js';
import { createWalletRescreenCaseLinker } from '../../src/composition/walletRescreenCaseLinker.js';

type MinimalCaseRepo = Pick<CaseRepository, 'findByCustomerOrBridgeId'>;

function fakeCaseRepo(returnValue: { id: string } | null): MinimalCaseRepo {
  return {
    findByCustomerOrBridgeId: jest.fn(async () => returnValue as any),
  };
}

describe('createWalletRescreenCaseLinker', () => {
  it('returns the case id string when a case is found', async () => {
    const repo = fakeCaseRepo({ id: 'case-abc123' });
    const linker = createWalletRescreenCaseLinker(repo as CaseRepository);
    const result = await linker.find('org-1', 'cust-1');
    expect(result).toBe('case-abc123');
    expect(repo.findByCustomerOrBridgeId).toHaveBeenCalledWith({
      organizationId: 'org-1',
      customerId: 'cust-1',
      statuses: ACTIVE_CASE_STATUSES,
    });
  });

  it('returns null when no OPEN or IN_REVIEW case exists', async () => {
    const repo = fakeCaseRepo(null);
    const linker = createWalletRescreenCaseLinker(repo as CaseRepository);
    const result = await linker.find('org-1', 'cust-1');
    expect(result).toBeNull();
  });
});

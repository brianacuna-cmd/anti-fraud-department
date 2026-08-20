import { oid } from '../../../../support/oid.js';
import { Investigation } from '../../../../../src/modules/case-management/domain/model/aggregates/Investigation.js';
import { createCaseId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createInvestigationId } from '../../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function open(subjectId: string): Investigation {
  return Investigation.open({
    id: createInvestigationId(oid('inv-1')),
    caseId: createCaseId(oid('case-1')),
    organizationId: oid('org-1'),
    subjectType: 'WALLET',
    subjectId,
    openedBy: oid('analyst-1'),
    now: NOW,
  });
}

describe('Investigation', () => {
  it('opens OPEN with no findings and no closedAt', () => {
    const investigation = open('wallet-abc');
    expect(investigation.status).toBe('OPEN');
    expect(investigation.findings).toBeNull();
    expect(investigation.closedAt).toBeNull();
    expect(investigation.subjectType).toBe('WALLET');
    expect(investigation.subjectId).toBe('wallet-abc');
  });

  it('rejects a blank subjectId', () => {
    expect(() => open('   ')).toThrow(CaseManagementError);
  });

  it('closes an OPEN investigation: CLOSED + findings + closedAt', () => {
    const closed = open('wallet-abc').close('confirmed mule wallet', NOW);
    expect(closed.status).toBe('CLOSED');
    expect(closed.findings).toBe('confirmed mule wallet');
    expect(closed.closedAt).toBe(NOW);
  });

  it('rejects closing with blank findings', () => {
    expect(() => open('wallet-abc').close('  ', NOW)).toThrow(CaseManagementError);
  });

  it('rejects closing an already-CLOSED investigation', () => {
    const closed = open('wallet-abc').close('done', NOW);
    expect(() => closed.close('again', NOW)).toThrow(CaseManagementError);
  });
});

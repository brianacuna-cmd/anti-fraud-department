import { oid } from '../../../../support/oid.js';
import { Resolution } from '../../../../../src/modules/case-management/domain/model/aggregates/Resolution.js';
import { createCaseId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createResolutionId } from '../../../../../src/modules/case-management/domain/model/value-objects/ResolutionId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function build(reason: string): Resolution {
  return Resolution.create({
    id: createResolutionId(oid('res-1')),
    caseId: createCaseId(oid('case-1')),
    organizationId: oid('org-1'),
    closureType: 'RESOLVED',
    reason,
    resolvedBy: oid('supervisor-1'),
    now: NOW,
  });
}

describe('Resolution', () => {
  it('creates a resolution, trimming the reason', () => {
    const resolution = build('  legitimate activity  ');
    expect(resolution.reason).toBe('legitimate activity');
    expect(resolution.closureType).toBe('RESOLVED');
  });

  it('rejects a blank reason', () => {
    expect(() => build('   ')).toThrow(CaseManagementError);
  });
});

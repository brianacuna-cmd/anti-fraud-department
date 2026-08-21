import { oid } from '../../../../support/oid.js';
import { Evidence } from '../../../../../src/modules/case-management/domain/model/aggregates/Evidence.js';
import { createCaseId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createEvidenceId } from '../../../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function register(overrides: { byteSize?: number; sha256?: string } = {}): Evidence {
  return Evidence.register({
    id: createEvidenceId(oid('ev-1')),
    caseId: createCaseId(oid('case-1')),
    investigationId: null,
    organizationId: oid('org-1'),
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    byteSize: overrides.byteSize ?? 1024,
    sha256: overrides.sha256 ?? 'deadbeef',
    storageKey: 'org/case/ev',
    timestamp: null,
    scanStatus: 'CLEAN',
    uploadedBy: oid('analyst-1'),
    now: NOW,
  });
}

describe('Evidence', () => {
  it('registers metadata with a null timestamp seam', () => {
    const evidence = register();
    expect(evidence.filename).toBe('invoice.pdf');
    expect(evidence.sha256).toBe('deadbeef');
    expect(evidence.investigationId).toBeNull();
    expect(evidence.timestamp).toBeNull();
  });

  it('rejects a non-positive byteSize', () => {
    expect(() => register({ byteSize: 0 })).toThrow(CaseManagementError);
  });

  it('rejects a blank sha256', () => {
    expect(() => register({ sha256: '   ' })).toThrow(CaseManagementError);
  });
});

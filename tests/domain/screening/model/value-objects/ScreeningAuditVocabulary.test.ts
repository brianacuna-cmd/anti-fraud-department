import type { ScreeningAuditAction, ScreeningAuditResource } from '../../../../../src/modules/screening/domain/model/value-objects/ScreeningAuditVocabulary.js';

/**
 * Compiler-level exhaustiveness check (design §5): every action/resource
 * listed here MUST be assignable to the closed union. If a value is
 * removed from the union, this file fails to compile, catching the drift
 * before it reaches `screeningAuditRecorderAdapter`.
 */
describe('ScreeningAuditVocabulary', () => {
  it('accepts all screening actions in the closed union', () => {
    const actions: readonly ScreeningAuditAction[] = [
      'RESOLVE_AML_ALERT',
      'CREATE_WATCHLIST',
      'UPDATE_WATCHLIST',
      'DELETE_WATCHLIST',
      'CREATE_WATCHLIST_ENTRY',
      'UPDATE_WATCHLIST_ENTRY',
      'DELETE_WATCHLIST_ENTRY',
      'SUBMIT_BULK_SCREENING_JOB',
      'COMPLETE_BULK_SCREENING_JOB',
      'FAIL_BULK_SCREENING_JOB',
    ];
    expect(actions).toHaveLength(10);
  });

  it('accepts all screening resources in the closed union', () => {
    const resources: readonly ScreeningAuditResource[] = [
      'aml_alert',
      'watchlist',
      'watchlist_entry',
      'bulk_screening_job',
    ];
    expect(resources).toHaveLength(4);
  });
});

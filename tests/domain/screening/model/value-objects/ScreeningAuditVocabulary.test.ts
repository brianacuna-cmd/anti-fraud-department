import type { ScreeningAuditAction, ScreeningAuditResource } from '../../../../../src/modules/screening/domain/model/value-objects/ScreeningAuditVocabulary.js';

/**
 * Compiler-level exhaustiveness check (design §5): every action/resource
 * listed here MUST be assignable to the closed union. If a value is
 * removed from the union, this file fails to compile, catching the drift
 * before it reaches `screeningAuditRecorderAdapter`.
 */
describe('ScreeningAuditVocabulary', () => {
  it('accepts the watchlist actions in the closed union', () => {
    const actions: readonly ScreeningAuditAction[] = [
      'RESOLVE_AML_ALERT',
      'CREATE_WATCHLIST',
      'UPDATE_WATCHLIST',
      'DELETE_WATCHLIST',
      'CREATE_WATCHLIST_ENTRY',
      'UPDATE_WATCHLIST_ENTRY',
      'DELETE_WATCHLIST_ENTRY',
    ];
    expect(actions).toHaveLength(7);
  });

  it('accepts the watchlist resources in the closed union', () => {
    const resources: readonly ScreeningAuditResource[] = ['aml_alert', 'watchlist', 'watchlist_entry'];
    expect(resources).toHaveLength(3);
  });
});

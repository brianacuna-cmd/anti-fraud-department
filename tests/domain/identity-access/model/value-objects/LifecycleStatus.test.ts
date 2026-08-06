import { createLifecycleStatus } from '../../../../../src/modules/identity-access/domain/model/value-objects/LifecycleStatus.js';

describe('createLifecycleStatus', () => {
  it.each(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DISABLED'] as const)(
    'accepts the valid status %s and returns it unchanged',
    (status) => {
      expect(createLifecycleStatus(status)).toBe(status);
    },
  );

  it('rejects a value outside the closed set as an invariant violation', () => {
    expect(() => createLifecycleStatus('BORRADO')).toThrow(/LifecycleStatus/);
  });

  it('rejects an empty string as an invariant violation', () => {
    expect(() => createLifecycleStatus('')).toThrow(/LifecycleStatus/);
  });
});

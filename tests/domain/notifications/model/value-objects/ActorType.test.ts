import { createActorType } from '../../../../../src/modules/notifications/domain/model/value-objects/ActorType.js';

describe('createActorType', () => {
  it.each(['USER', 'ORGANIZATION', 'PLATFORM_ADMIN'] as const)('accepts %s', (value) => {
    expect(createActorType(value)).toBe(value);
  });

  it('rejects an unknown value as an invariant violation', () => {
    expect(() => createActorType('SUPERUSER')).toThrow(/ActorType/);
  });
});

import { createActorType } from '../../../../../src/modules/identity-access/domain/model/value-objects/ActorType.js';
import type { ActorType as KernelActorType } from '../../../../../src/shared/kernel/AuthContext.js';
import type { ActorType as AuditActorType } from '../../../../../src/modules/audit/domain/model/ActorType.js';

describe('createActorType', () => {
  it.each(['USER', 'ORGANIZATION', 'PLATFORM_ADMIN'] as const)('accepts %s', (value) => {
    expect(createActorType(value)).toBe(value);
  });

  it('rejects an unknown value as an invariant violation', () => {
    expect(() => createActorType('SUPERUSER')).toThrow(/ActorType/);
  });

  it('rejects SERVICE and kernel/audit unions omit it', () => {
    const kernel: Record<KernelActorType, true> = { USER: true, ORGANIZATION: true, PLATFORM_ADMIN: true };
    const audit: Record<AuditActorType, true> = { USER: true, ORGANIZATION: true, PLATFORM_ADMIN: true };
    expect(() => createActorType('SERVICE')).toThrow(/ActorType/);
    expect(Object.keys(kernel)).not.toContain('SERVICE');
    expect(Object.keys(audit)).not.toContain('SERVICE');
  });
});

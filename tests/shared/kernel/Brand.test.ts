import { brand, type Brand } from '../../../src/shared/kernel/Brand.js';

type OrganizationId = Brand<string, 'OrganizationId'>;
type UserId = Brand<string, 'UserId'>;

describe('brand', () => {
  it('returns the exact same runtime value it was given (identity function)', () => {
    const raw = 'org-123';

    const branded = brand<string, 'OrganizationId'>(raw);

    expect(branded).toBe(raw);
  });

  it('preserves value equality across two different brand tags applied to the same primitive', () => {
    const orgId: OrganizationId = brand<string, 'OrganizationId'>('shared-id');
    const userId: UserId = brand<string, 'UserId'>('shared-id');

    // Nominal typing is a compile-time-only distinction — at runtime these
    // remain plain strings and compare equal when the underlying value matches.
    expect(String(orgId)).toBe(String(userId));
  });

  it('does not mutate or wrap non-string primitives either', () => {
    const rawNumber = 42;

    const branded = brand<number, 'RiskScore'>(rawNumber);

    expect(branded).toBe(rawNumber);
  });
});

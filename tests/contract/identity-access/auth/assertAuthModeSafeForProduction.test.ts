import { assertAuthModeSafeForProduction } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/assertAuthModeSafeForProduction.js';

describe('assertAuthModeSafeForProduction', () => {
  it('throws when NODE_ENV=production and AUTH_MODE=trusted-header (fail-closed)', () => {
    expect(() => assertAuthModeSafeForProduction('production', 'trusted-header')).toThrow(/trusted-header/);
  });

  it('does not throw when NODE_ENV=production and AUTH_MODE is anything else', () => {
    expect(() => assertAuthModeSafeForProduction('production', 'jwt')).not.toThrow();
  });

  it('does not throw when AUTH_MODE=trusted-header outside production', () => {
    expect(() => assertAuthModeSafeForProduction('development', 'trusted-header')).not.toThrow();
    expect(() => assertAuthModeSafeForProduction(undefined, 'trusted-header')).not.toThrow();
  });
});

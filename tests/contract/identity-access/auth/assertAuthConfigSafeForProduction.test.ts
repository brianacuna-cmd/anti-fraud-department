import { assertAuthConfigSafeForProduction } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/assertAuthConfigSafeForProduction.js';

describe('assertAuthConfigSafeForProduction (design D6 — tier-aware)', () => {
  it('throws when NODE_ENV=production and AUTH_MODE=trusted-header (fail-closed, unchanged)', () => {
    expect(() => assertAuthConfigSafeForProduction('production', 'trusted-header', 'disabled')).toThrow(
      /trusted-header/,
    );
  });

  it('does NOT throw when NODE_ENV=production and AUTH_MODE=session (design D6 — now prod-safe for USER/ORG)', () => {
    expect(() => assertAuthConfigSafeForProduction('production', 'session', 'disabled')).not.toThrow();
  });

  it('does not throw when NODE_ENV=production and AUTH_MODE is anything else', () => {
    expect(() => assertAuthConfigSafeForProduction('production', 'jwt', 'disabled')).not.toThrow();
  });

  it('does not throw when AUTH_MODE=trusted-header outside production', () => {
    expect(() => assertAuthConfigSafeForProduction('development', 'trusted-header', 'disabled')).not.toThrow();
    expect(() => assertAuthConfigSafeForProduction(undefined, 'trusted-header', 'disabled')).not.toThrow();
  });

  it('throws when NODE_ENV=production and PLATFORM_ADMIN_AUTH=trusted-header (design D6 — admin trusted-header is prod-forbidden)', () => {
    expect(() => assertAuthConfigSafeForProduction('production', 'session', 'trusted-header')).toThrow(
      /PLATFORM_ADMIN_AUTH/,
    );
  });

  it('does not throw when NODE_ENV=production and PLATFORM_ADMIN_AUTH=disabled (default)', () => {
    expect(() => assertAuthConfigSafeForProduction('production', 'session', 'disabled')).not.toThrow();
  });

  it('does not throw when PLATFORM_ADMIN_AUTH=trusted-header outside production', () => {
    expect(() => assertAuthConfigSafeForProduction('development', 'session', 'trusted-header')).not.toThrow();
  });
});

import { assertAuthConfigSafeForProduction, DEV_TOKEN_SECRET } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/assertAuthConfigSafeForProduction.js';

/** 32 caracteres: lo minimo que el guard acepta en produccion. */
const GOOD_SECRET = 'x'.repeat(48);

describe('assertAuthConfigSafeForProduction (design D6 — tier-aware)', () => {
  it('throws when NODE_ENV=production and AUTH_MODE=trusted-header (fail-closed, unchanged)', () => {
    expect(() => assertAuthConfigSafeForProduction('production', 'trusted-header', 'disabled', GOOD_SECRET)).toThrow(
      /trusted-header/,
    );
  });

  it('does NOT throw when NODE_ENV=production and AUTH_MODE=session (design D6 — now prod-safe for USER/ORG)', () => {
    expect(() => assertAuthConfigSafeForProduction('production', 'session', 'disabled', GOOD_SECRET)).not.toThrow();
  });

  it('does not throw when NODE_ENV=production and AUTH_MODE is anything else', () => {
    expect(() => assertAuthConfigSafeForProduction('production', 'jwt', 'disabled', GOOD_SECRET)).not.toThrow();
  });

  it('does not throw when AUTH_MODE=trusted-header outside production', () => {
    expect(() => assertAuthConfigSafeForProduction('development', 'trusted-header', 'disabled')).not.toThrow();
    expect(() => assertAuthConfigSafeForProduction(undefined, 'trusted-header', 'disabled')).not.toThrow();
  });

  it('throws when NODE_ENV=production and PLATFORM_ADMIN_AUTH=trusted-header (design D6 — admin trusted-header is prod-forbidden)', () => {
    expect(() => assertAuthConfigSafeForProduction('production', 'session', 'trusted-header', GOOD_SECRET)).toThrow(
      /PLATFORM_ADMIN_AUTH/,
    );
  });

  it('does not throw when NODE_ENV=production and PLATFORM_ADMIN_AUTH=disabled (default)', () => {
    expect(() => assertAuthConfigSafeForProduction('production', 'session', 'disabled', GOOD_SECRET)).not.toThrow();
  });

  it('does not throw when PLATFORM_ADMIN_AUTH=trusted-header outside production', () => {
    expect(() => assertAuthConfigSafeForProduction('development', 'session', 'trusted-header')).not.toThrow();
  });
});

describe('TOKEN_SECRET', () => {
  it('throws in production when TOKEN_SECRET is missing', () => {
    expect(() => assertAuthConfigSafeForProduction('production', 'session', 'disabled')).toThrow(
      /TOKEN_SECRET must be set/,
    );
    expect(() => assertAuthConfigSafeForProduction('production', 'session', 'disabled', '  ')).toThrow(
      /TOKEN_SECRET must be set/,
    );
  });

  /**
   * The case that actually matters: the default value starts without
   * complaining and signs valid sessions, so a deployment can stand for
   * months with a secret anyone can read in the repository.
   */
  it('throws in production when TOKEN_SECRET is still the development default', () => {
    expect(() =>
      assertAuthConfigSafeForProduction('production', 'session', 'disabled', DEV_TOKEN_SECRET),
    ).toThrow(/development default/);
  });

  it('throws in production when TOKEN_SECRET is too short to be worth anything', () => {
    expect(() =>
      assertAuthConfigSafeForProduction('production', 'session', 'disabled', 'cambiar'),
    ).toThrow(/at least 32 characters/);
  });

  it('accepts a real secret in production', () => {
    expect(() =>
      assertAuthConfigSafeForProduction('production', 'session', 'disabled', GOOD_SECRET),
    ).not.toThrow();
  });

  /** Outside production the default is exactly what you want. */
  it('ignores TOKEN_SECRET outside production', () => {
    expect(() =>
      assertAuthConfigSafeForProduction('development', 'session', 'disabled', DEV_TOKEN_SECRET),
    ).not.toThrow();
    expect(() => assertAuthConfigSafeForProduction(undefined, 'session', 'disabled')).not.toThrow();
  });
});

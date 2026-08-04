import {
  createUserSchema,
  patchUserSchema,
  transitionUserSchema,
} from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/dto/userSchemas.js';

describe('createUserSchema', () => {
  it('accepts a valid payload', () => {
    const result = createUserSchema.safeParse({
      email: 'alice@example.com',
      password: 'super-secret',
      firstName: 'Alice',
      lastName: 'Smith',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a payload missing the required password', () => {
    const result = createUserSchema.safeParse({ email: 'alice@example.com', firstName: 'Alice', lastName: 'Smith' });

    expect(result.success).toBe(false);
  });

  it('rejects an empty email', () => {
    const result = createUserSchema.safeParse({ email: '', password: 'pw', firstName: 'A', lastName: 'S' });

    expect(result.success).toBe(false);
  });
});

describe('patchUserSchema (allow-list)', () => {
  it('accepts firstName, lastName, email, and avatarUrl', () => {
    const result = patchUserSchema.safeParse({
      firstName: 'Alicia',
      lastName: 'Smith',
      email: 'alicia@example.com',
      avatarUrl: 'https://example.com/a.png',
    });

    expect(result.success).toBe(true);
  });

  it('accepts an empty patch (all fields optional)', () => {
    const result = patchUserSchema.safeParse({});

    expect(result.success).toBe(true);
  });

  it.each(['roleIds', 'mfa', 'notificationPreferences', 'passwordHash', 'passwordSalt', 'loginAttempts', 'lockedUntil', 'lastLogin', 'isPlatformAdmin'])(
    'rejects a payload attempting to set %s',
    (field) => {
      const result = patchUserSchema.safeParse({ [field]: 'anything' });

      expect(result.success).toBe(false);
    },
  );
});

describe('transitionUserSchema', () => {
  it.each(['ACTIVO', 'INACTIVO', 'SUSPENDIDO', 'DESHABILITADO'])('accepts the valid status %s', (next) => {
    const result = transitionUserSchema.safeParse({ next });

    expect(result.success).toBe(true);
  });

  it('rejects a status outside the closed set', () => {
    const result = transitionUserSchema.safeParse({ next: 'BORRADO' });

    expect(result.success).toBe(false);
  });
});

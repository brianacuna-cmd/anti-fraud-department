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

  it('accepts a valid payload with middleName (design A12)', () => {
    const result = createUserSchema.safeParse({
      email: 'alice@example.com',
      password: 'super-secret',
      firstName: 'Alice',
      middleName: 'Marie',
      lastName: 'Smith',
    });

    expect(result.success).toBe(true);
  });

  it('accepts middleName omitted or null', () => {
    expect(
      createUserSchema.safeParse({
        email: 'alice@example.com',
        password: 'super-secret',
        firstName: 'Alice',
        lastName: 'Smith',
        middleName: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a blank middleName', () => {
    const result = createUserSchema.safeParse({
      email: 'alice@example.com',
      password: 'super-secret',
      firstName: 'Alice',
      middleName: '',
      lastName: 'Smith',
    });

    expect(result.success).toBe(false);
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
  it('accepts firstName, lastName, email, middleName, and avatarUrl', () => {
    const result = patchUserSchema.safeParse({
      firstName: 'Alicia',
      lastName: 'Smith',
      email: 'alicia@example.com',
      middleName: 'Marie',
      avatarUrl: 'https://example.com/a.png',
    });

    expect(result.success).toBe(true);
  });

  it('accepts middleName set to null (design A12)', () => {
    const result = patchUserSchema.safeParse({ middleName: null });

    expect(result.success).toBe(true);
  });

  it('accepts an empty patch (all fields optional)', () => {
    const result = patchUserSchema.safeParse({});

    expect(result.success).toBe(true);
  });

  it.each(['roleId', 'roleIds', 'mfa', 'resetToken', 'notificationPreferences', 'passwordHash', 'passwordSalt', 'loginAttempts', 'lockedUntil', 'lastLogin', 'isPlatformAdmin'])(
    'rejects a payload attempting to set %s (task 5.6 — strict allow-list)',
    (field) => {
      const result = patchUserSchema.safeParse({ [field]: 'anything' });

      expect(result.success).toBe(false);
    },
  );
});

describe('transitionUserSchema', () => {
  it.each(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DISABLED'])('accepts the valid status %s', (next) => {
    const result = transitionUserSchema.safeParse({ next });

    expect(result.success).toBe(true);
  });

  it('rejects a status outside the closed set', () => {
    const result = transitionUserSchema.safeParse({ next: 'BORRADO' });

    expect(result.success).toBe(false);
  });
});

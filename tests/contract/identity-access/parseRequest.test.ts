import { z } from 'zod';
import { parseRequest } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/parseRequest.js';
import { IdentityAccessError } from '../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const schema = z.object({ name: z.string().min(1) });

describe('parseRequest', () => {
  it('returns the parsed value when the payload matches the schema', () => {
    const result = parseRequest(schema, { name: 'Acme' });

    expect(result).toEqual({ name: 'Acme' });
  });

  it('throws an INVARIANT_VIOLATION IdentityAccessError when the payload fails validation', () => {
    expect.assertions(2);
    try {
      parseRequest(schema, { name: '' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVARIANT_VIOLATION');
    }
  });
});

import { DomainError } from '../../../src/shared/kernel/DomainError.js';

class TestDomainError extends DomainError {
  constructor(metadata: Readonly<Record<string, unknown>> = {}) {
    super('TEST_ERROR', 'something went wrong', metadata);
  }
}

describe('DomainError', () => {
  it('exposes code, message, and metadata passed to the constructor', () => {
    const error = new TestDomainError({ field: 'slug', value: 'acme' });

    expect(error.code).toBe('TEST_ERROR');
    expect(error.message).toBe('something went wrong');
    expect(error.metadata).toEqual({ field: 'slug', value: 'acme' });
  });

  it('defaults metadata to an empty object when none is given', () => {
    const error = new TestDomainError();

    expect(error.metadata).toEqual({});
  });

  it('is a real Error instance usable with try/catch and instanceof', () => {
    const raise = (): never => {
      throw new TestDomainError({ reason: 'boom' });
    };

    expect(raise).toThrow('something went wrong');
    try {
      raise();
    } catch (caught) {
      expect(caught).toBeInstanceOf(DomainError);
      expect(caught).toBeInstanceOf(Error);
    }
  });
});

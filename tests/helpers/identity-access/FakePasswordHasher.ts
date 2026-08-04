import type { PasswordHasher } from '../../../src/modules/identity-access/domain/ports/PasswordHasher.js';
import { createPasswordCredential, type PasswordCredential } from '../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';

/** Deterministic `PasswordHasher` fake for unit tests — no real scrypt I/O. */
export class FakePasswordHasher implements PasswordHasher {
  hashCallCount = 0;

  async hash(plainPassword: string): Promise<PasswordCredential> {
    this.hashCallCount += 1;
    return createPasswordCredential(`hashed:${plainPassword}`, 'fixed-salt');
  }
}

import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import type { PasswordHasher } from '../../../../domain/ports/PasswordHasher.js';
import { createPasswordCredential, type PasswordCredential } from '../../../../domain/model/value-objects/PasswordCredential.js';

const scryptAsync = promisify(scrypt);
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

/**
 * The only `PasswordHasher` implementation allowed to touch `node:crypto`
 * (user-lifecycle spec: "password hashed via node:crypto scrypt"). A fresh
 * random salt is generated per call so the same password never produces the
 * same hash twice.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plainPassword: string): Promise<PasswordCredential> {
    const salt = randomBytes(SALT_BYTES).toString('hex');
    const derivedKey = (await scryptAsync(plainPassword, salt, KEY_LENGTH)) as Buffer;
    return createPasswordCredential(derivedKey.toString('hex'), salt);
  }
}

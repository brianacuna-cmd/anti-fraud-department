import { authenticator } from 'otplib';
import type { TotpService } from '../../../../domain/ports/TotpService.js';

/**
 * `TotpService` backed by otplib's `authenticator`. The only place in the
 * codebase allowed to import otplib, mirroring how `AesGcmSecretCipher` is the
 * only place allowed to touch `node:crypto` (design D13). TOTP is pure CPU
 * work (no I/O), so the port stays synchronous.
 */
export class OtplibTotpService implements TotpService {
  generateSecret(): string {
    return authenticator.generateSecret();
  }

  keyUri(accountName: string, issuer: string, secret: string): string {
    return authenticator.keyuri(accountName, issuer, secret);
  }

  verify(token: string, secret: string): boolean {
    return authenticator.verify({ token, secret });
  }
}

import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { TotpService } from '../domain/ports/TotpService.js';
import type { QrCodeGenerator } from '../domain/ports/QrCodeGenerator.js';
import type { SecretCipher } from '../domain/ports/SecretCipher.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { userNotFound } from '../domain/errors/IdentityAccessError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface SetupMfaInput {
  readonly auth: AuthContext;
}

export interface SetupMfaResult {
  readonly qrCodeDataUrl: string;
  readonly otpauthUri: string;
}

export interface SetupMfaDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly totpService: TotpService;
  readonly qrCodeGenerator: QrCodeGenerator;
  readonly secretCipher: SecretCipher;
  /** otpauth issuer name (`AUTH_TOTP_ISSUER`, default `'AntiFraud'`, wired at the composition root). */
  readonly issuer: string;
}

/**
 * Starts (or restarts) MFA enrollment for the AUTHENTICATED user
 * (mfa-user-enrollment PR2). Generates a fresh plaintext TOTP secret,
 * encrypts it via `SecretCipher` before it ever touches the aggregate
 * (store-at-setup design decision — `enabled` stays `false` until
 * `ActivateMfa` verifies a token), and returns a QR code the client renders
 * for the user to scan into their authenticator app. No audit event here —
 * the secret is not yet active (mirrors `ActivateMfa` emitting `MFA_ENABLED`
 * only once confirmed).
 */
export function createSetupMfaUseCase(deps: SetupMfaDeps) {
  return async function setupMfa(input: SetupMfaInput): Promise<SetupMfaResult> {
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const repository = deps.userRepositoryFactory.forTenant(organizationId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const userId = createUserId(input.auth.userId);
      const user = await repository.findById(userId);
      if (!user) {
        throw userNotFound(input.auth.userId);
      }

      const secret = deps.totpService.generateSecret();
      const encryptedSecret = deps.secretCipher.encrypt(secret);
      const enrolling = user.startMfaEnrollment(encryptedSecret, deps.clock.now());
      await repository.save(enrolling, tx);

      const otpauthUri = deps.totpService.keyUri(user.email, deps.issuer, secret);
      const qrCodeDataUrl = await deps.qrCodeGenerator.toDataUrl(otpauthUri);

      return { qrCodeDataUrl, otpauthUri };
    });
  };
}

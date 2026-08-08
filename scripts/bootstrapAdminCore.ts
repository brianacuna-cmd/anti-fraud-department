import type { Clock } from '../src/shared/time/Clock.js';
import type { AdminOrganizationRepository } from '../src/modules/identity-access/domain/ports/AdminOrganizationRepository.js';
import type { AdminKeyPairGenerator } from '../src/modules/identity-access/domain/ports/AdminKeyPairGenerator.js';
import type { SecretCipher } from '../src/modules/identity-access/domain/ports/SecretCipher.js';
import type { AuditRecorder } from '../src/modules/identity-access/domain/ports/AuditRecorder.js';
import type { AdminOrganization } from '../src/modules/identity-access/domain/model/aggregates/AdminOrganization.js';
import type { AdminOrganizationId } from '../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import type { AdminKeyId } from '../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { provisionAdminOrganizationCore } from '../src/modules/identity-access/application/admin/provisionAdminOrganizationCore.js';

export interface BootstrapAdminDeps {
  readonly admins: AdminOrganizationRepository;
  readonly keyPairs: AdminKeyPairGenerator;
  readonly cipher: SecretCipher;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
  readonly generateAdminOrganizationId: () => AdminOrganizationId;
  readonly generateAdminKeyId: () => AdminKeyId;
}

export interface BootstrapAdminParams {
  readonly email: string;
}

export type BootstrapAdminResult =
  | { readonly ok: true; readonly admin: AdminOrganization; readonly privateKeyPkcs8Pem: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Testable core of the admin #0 bootstrap flow (design "Bootstrap script
 * (admin #0)", tasks 1c). Deliberately has NO `process.env`/`process.exit`/
 * stdout side effects — those belong to the CLI entrypoint
 * (`bootstrap-admin.ts`), which wires real Mongo/crypto adapters and calls
 * this function. Guards on `admins.countAll()` (design D43c): a second
 * `AdminOrganization` is never created, and nothing is mutated on refusal.
 * Reuses `provisionAdminOrganizationCore` — the SAME keygen/encrypt logic
 * `ProvisionAdminOrganization` (HTTP, `requirePlatformAdmin`-gated) uses —
 * bypassing only the HTTP authorization gate, which has no admin to
 * authorize it yet on a fresh system.
 */
export async function runBootstrapAdmin(
  deps: BootstrapAdminDeps,
  params: BootstrapAdminParams,
): Promise<BootstrapAdminResult> {
  const existingCount = await deps.admins.countAll();
  if (existingCount > 0) {
    return {
      ok: false,
      reason: `refuse: an AdminOrganization already exists (countAll=${existingCount}) — admin #0 was already bootstrapped`,
    };
  }

  const now = deps.clock.now();
  const { admin, privateKeyPkcs8Pem } = provisionAdminOrganizationCore(
    {
      keyPairs: deps.keyPairs,
      cipher: deps.cipher,
      generateAdminOrganizationId: deps.generateAdminOrganizationId,
      generateAdminKeyId: deps.generateAdminKeyId,
    },
    { email: params.email, now },
  );

  await deps.admins.save(admin);

  await deps.auditRecorder.record({
    // Platform-level, no authenticated actor exists yet (design D-A6) —
    // this IS the event that creates the first one.
    organizationId: null,
    actorType: 'PLATFORM_ADMIN',
    actorId: null,
    action: 'PLATFORM_ADMIN_PROVISIONED',
    resource: 'adminOrganizations',
    resourceId: admin.id,
    detail: { email: admin.email, via: 'bootstrap' },
    ipAddress: null,
  });

  return { ok: true, admin, privateKeyPkcs8Pem };
}

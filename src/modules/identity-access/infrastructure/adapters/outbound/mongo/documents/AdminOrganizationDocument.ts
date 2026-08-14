/**
 * Mongo document shape for `adminOrganizations` (design D31/D39). `_id` is
 * the aggregate's branded `AdminOrganizationId` (a `crypto.randomUUID()`
 * string) — never a driver-generated `ObjectId`, matching
 * `OrganizationDocument`/`UserDocument`.
 *
 * `keys` is the embedded rotation-history array (design D31): bounded, always
 * read whole, never a separate collection. Field names are camelCase
 * (verified worktree finding, design D39) — this module does NOT follow the
 * parent design's stated PascalCase convention, matching what
 * `OrganizationDocument`/`UserDocument` actually ship.
 */
export interface AdminKeyDocument {
  readonly keyId: string;
  readonly publicKey: string;
  readonly status: string;
  readonly encryptedPrivateKey: string | null;
  readonly privateKeyDownloadedAt: string | null;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
  readonly revokedAt: string | null;
}

export interface AdminOrganizationDocument {
  readonly _id: string;
  readonly email: string;
  readonly keys: readonly AdminKeyDocument[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

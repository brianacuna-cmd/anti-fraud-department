# Design: Identity-Access Organization & User CRUD with Status Lifecycle

## Technical Approach

Hexagonal slice inside `src/modules/identity-access/`, plus the minimal cross-cutting bootstrap it needs. Domain stays pure (values in, values out, no clock, no I/O). Application owns transaction and coarse authorization. Infrastructure owns Express, zod, Mongo, scrypt, and auth-context resolution. Lifecycle is a lookup table (Addendum §21.3); the reactivation restriction is a domain rule fed by an actor **value**, not a port.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|---|---|---|---|
| D1 | Domain layout | `model/{value-objects,aggregates}`, `errors/`, `ports/`, `services/`; `entities/`+`events/` stay empty | flat `domain/` | ESTRUCTURA_REPO §1–2 is normative and ESLint globs depend on it |
| D2 | Where reactivation gate lives | Domain `StatusTransitionPolicy` taking a `TransitionActor` VO; application resolves the actor | app-only check | "Reactivation requires platform-admin" is a lifecycle invariant, not transport. §25.1 bans I/O, not input values — same shape as `Rule(signal)`. App-only would let any future caller bypass it |
| D3 | Coarse authz | `requirePlatformAdmin(auth)` guard in application for all `/organizations` use cases → `FORBIDDEN_CROSS_TENANT`; tenant scoping enforced by construction (`TenantContext`) | domain checks routes | Route reachability is not a domain fact |
| D4 | Auth context | `AuthContext {userId, organizationId, isPlatformAdmin}` in `shared/kernel`; `TrustedHeaderAuthContextResolver` reads `x-actor-*` headers, enabled only when `AUTH_MODE=trusted-header`; **startup aborts if `NODE_ENV=production` and mode is trusted-header** | in-code stub user; skipping auth | Real JWT middleware later swaps the resolver only. Fail-closed prevents a dev shim reaching prod |
| D5 | Errors | One `IdentityAccessError extends DomainError(code, message, metadata)`; closed `IdentityAccessErrorCode` union; code→HTTP status lookup in the HTTP layer | 8 subclasses; `httpStatus` on DomainError | The union enforces closure at compile time; subclasses add ceremony, no invariant. Status in domain would leak HTTP |
| D6 | Transaction | Domain port `UnitOfWork.withTransaction(work(tx))` with an **opaque** `Transaction` type; Mongo adapter casts to `ClientSession` and uses `session.withTransaction` | AsyncLocalStorage ambient session; mongodb types in ports | Explicit and fake-able; keeps the driver out of domain/application |
| D7 | Repo tenancy | `MongoUserRepository(tenant, db)` binds `TenantContext`; `MongoOrganizationRepository(db)` does not | binding tenant to both | `organizations` **has no `organizationId` field** (MODELO_DATOS §3) — it is the tenant root, so there is no filter to bind and a bound context would be false safety. Its boundary is D3 |
| D8 | Cross-tenant bootstrap | `UserRepositoryFactory.forTenant(orgId)` port; `CreateOrganizationWithAdmin` builds a repo bound to the **new** org | reusing the caller's user repo | The caller's tenant is the platform-admin's org, not the new one. Addendum §C.4 names "new repo with a different TenantContext" as the only legal crossing |
| D9 | Status type | One `LifecycleStatus` union, two tables (`ORGANIZATION_TRANSITIONS`, `USER_TRANSITIONS`) | branded per-entity status VOs | Identical value sets; aggregate signatures already prevent mixing. Tables may diverge later |
| D10 | ESLint | Allow `domain → shared/kernel|time`, keep `domain → shared/audit|outbox` denied | duplicating `TenantContext`/`Instant`/`Brand` per module | Current `disallow: ['shared']` contradicts ESTRUCTURA_REPO §2–3, which places `TenantContext`/`Instant` in `shared` as domain values |

## Data Flow

    HTTP ─→ authContextMiddleware ─→ router ─→ zod DTO ─→ HttpMapper ─→ UseCase
                                                                          │
                        requirePlatformAdmin / TenantContext ─────────────┤
                                                                          ↓
                        Aggregate.transitionTo(next, actor, now) ─→ StatusTransitionPolicy
                                                                          ↓
                        UnitOfWork.withTransaction ─→ Mongo repos ─→ DocumentMapper
                                                                          ↓
                        IdentityAccessError ─→ errorHandler ─→ {error:{code,message,metadata}}

Bootstrap: `main.ts` → connect Mongo → **assert replica set** (`hello().setName`, else abort with a `--replSet rs0` hint) → `ensureIndexes` → build resolver/repos/use cases → mount `/api/v1` routers → `errorHandler` last.

## File Changes

| Path | Action | Contents |
|---|---|---|
| `src/shared/kernel/` | Create | `Brand.ts`, `DomainError.ts`, `TenantContext.ts`, `AuthContext.ts` |
| `src/shared/time/` | Create | `Instant.ts`, `Clock.ts`, `SystemClock.ts` |
| `src/shared/http/` | Create | `errorHandler.ts` (`createErrorHandler(statusByCode)`), `pagination.ts` (`limit` 25/max 100, `{items,nextCursor}`) |
| `src/shared/persistence/mongo/` | Create | `connect.ts` (+ replica-set assertion), `ensureIndexes.ts` |
| `…/identity-access/domain/model/value-objects/` | Create | `OrganizationId`, `UserId`, `Email`, `Slug`, `LifecycleStatus`, `PasswordCredential`, `TransitionActor` |
| `…/domain/model/aggregates/` | Create | `Organization.ts`, `User.ts` (private ctor, `create`/`rehydrate`/`patchIdentity`/`transitionTo`, all returning new instances) |
| `…/domain/services/` | Create | `transitions.ts`, `StatusTransitionPolicy.ts` |
| `…/domain/errors/` | Create | `IdentityAccessErrorCode.ts`, `IdentityAccessError.ts` |
| `…/domain/ports/` | Create | `OrganizationRepository`, `UserRepository`, `UserRepositoryFactory`, `UnitOfWork`, `PasswordHasher` |
| `…/application/` | Create | 10 use cases + `authorization/requirePlatformAdmin.ts` |
| `…/infrastructure/adapters/inbound/http/` | Create | `organizationRouter.ts`, `userRouter.ts`, `dto/*Schemas.ts`, `mappers/*HttpMapper.ts`, `auth/{AuthContextResolver,TrustedHeaderAuthContextResolver,authContextMiddleware}.ts`, `errorStatus.ts` |
| `…/infrastructure/adapters/outbound/mongo/` | Create | `BaseMongoRepository.ts`, `MongoOrganizationRepository.ts`, `MongoUserRepository.ts`, `MongoUnitOfWork.ts`, `documents.ts`, `*DocumentMapper.ts`, `duplicateKey.ts`, `indexes.ts` |
| `…/infrastructure/adapters/outbound/crypto/ScryptPasswordHasher.ts` | Create | `node:crypto` scrypt, returns `{hash, salt}` |
| `src/main.ts` | Modify | Replace TODO with the bootstrap above |
| `eslint.config.js` | Modify | D10 |
| `jest.config.js` | Modify | Add `moduleNameMapper: {'^(\\.{1,2}/.*)\\.js$': '$1'}` |
| `docs/MODELO_DATOS_MONGO.md`, `docs/ESTRUCTURA_REPO.md` | Modify | `isPlatformAdmin` field; new `shared/{http,persistence}` folders |

## Interfaces / Contracts

```ts
export type TransitionTable = Readonly<Record<LifecycleStatus, readonly LifecycleStatus[]>>;
export const ORGANIZATION_TRANSITIONS: TransitionTable = {
  ACTIVO: ['INACTIVO', 'SUSPENDIDO', 'DESHABILITADO'],
  INACTIVO: ['ACTIVO', 'SUSPENDIDO', 'DESHABILITADO'],
  SUSPENDIDO: ['ACTIVO', 'INACTIVO', 'DESHABILITADO'],
  DESHABILITADO: ['ACTIVO'],
}; // Record<> makes a new status a compile error; no key lists itself, so X→X is invalid

// domain/services/StatusTransitionPolicy.ts — max-depth 0
export function assertTransitionAllowed(t, current, next, actor: TransitionActor): void {
  if (!t[current].includes(next)) throw invalidTransition(current, next);
  if (!isReactivation(current, next)) return;
  if (actor.isPlatformAdmin) return;
  throw forbiddenReactivation(current, next);
}

export interface Transaction { readonly __tx: unique symbol }        // opaque
export interface UnitOfWork { withTransaction<T>(w: (tx: Transaction) => Promise<T>): Promise<T> }
export interface UserRepositoryFactory { forTenant(id: OrganizationId): UserRepository }
```

`errorStatus`: `INVALID_TRANSITION` 422 · `FORBIDDEN_REACTIVATION`/`FORBIDDEN_CROSS_TENANT` 403 · `*_TAKEN` 409 · `*_NOT_FOUND` 404 · `INVARIANT_VIOLATION` 400 · else 500 `INTERNAL` (no metadata).
Uniqueness: named indexes `slug_unique` / `user_email_unique`; `duplicateKey.ts` maps E11000 by **index name**, never by message parsing.
Cursor: `_id` ascending, `{_id: {$gt: cursor}}`.

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (`tests/domain`) | Full 4×4 transition matrix ×2 entities ×2 actors (32 cases), VO guards, aggregate immutability | Table-driven, no doubles |
| Unit (application) | `requirePlatformAdmin`, bootstrap rollback, cross-tenant factory use | In-memory fakes for ports incl. `UnitOfWork` |
| Contract (`tests/contract`) | zod DTO rejection, patch allow-lists (no `roleIds`/`mfa`/password), error envelope + status map | Mapper-level |
| Integration (`tests/integration`) | Real replica-set Mongo: atomic bootstrap + rollback, duplicate-key translation, tenant isolation (two orgs), `DELETE` ≡ `POST /transition DESHABILITADO` | supertest + Mongo |

RED first per unit, domain-first.

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. HTTP-auth risk is handled by D4's fail-closed production check, covered by a dedicated startup test.

## Migration / Rollout

No migration. New collections/indexes only; `isPlatformAdmin` is additive and optional (absent ⇒ `false`).

## Open Questions — resolved

- [x] `INVARIANT_VIOLATION` joins the closed error-code list (VO/zod guard failures need a code). Confirmed.
- [x] "Org admin" has no representation in this change (roles are out of scope). **Decision (user-confirmed):** any non-platform-admin authenticated user can administer users in their own org for this slice — no `isOrgAdmin` flag added now, to avoid a second role system parallel to `roleIds`/`access-control`. Revisit once `access-control` ships real roles.

# Tasks: Identity-Access Organization & User CRUD with Status Lifecycle

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1150–1350 (Slice 1 ~250, Slice 2 ~450, Slice 3 ~500) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (bootstrap/shared kernel) → PR 2 (organizations) → PR 3 (users incl. cross-tenant bootstrap) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending (user decision required) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Shared kernel + bootstrap: AuthContext, DomainError, UnitOfWork port, error handler, Mongo connect/indexes/replica-set guard, app factory, `main.ts` | PR 1 | `npm test -- tests/shared` | `node src/main.ts` against a local `--replSet rs0` Mongo (manual smoke; no routes yet to supertest) | Revert `src/shared/**`, `src/main.ts`, `eslint.config.js`, `jest.config.js` — no dependents yet |
| 2 | Organizations vertical slice: aggregate, VOs, transition policy, Mongo repo, use cases, router | PR 2 | `npm test -- tests/domain/organization tests/application/organization tests/contract/organization` | `supertest` against `organizationRouter` mounted on the PR-1 app factory + real replica-set Mongo (`tests/integration/organization`) | Revert `…/identity-access/{domain,application,infrastructure}/**organization**` and router mount line; PR 1 unaffected |
| 3 | Users vertical slice + cross-tenant org+admin bootstrap: aggregate, VOs, repo, factory port, use cases (incl. `CreateOrganizationWithAdmin`), router | PR 3 | `npm test -- tests/domain/user tests/application/user tests/contract/user` | `supertest` against `userRouter` + bootstrap use case against real replica-set Mongo (`tests/integration/user`, `tests/integration/bootstrap`) | Revert `…/identity-access/{domain,application,infrastructure}/**user**` and `CreateOrganizationWithAdmin`; PR 1–2 unaffected |

## Phase 1: Shared Kernel & Bootstrap (PR 1)

- [x] 1.1 RED: `tests/shared/kernel/DomainError.test.ts` — base class exposes `code`, `message`, `metadata`
- [x] 1.2 GREEN: `src/shared/kernel/DomainError.ts`
- [x] 1.3 RED: `tests/shared/kernel/Brand.test.ts` — branding helper produces nominally-distinct types at compile-time boundary (runtime identity test)
- [x] 1.4 GREEN: `src/shared/kernel/Brand.ts`
- [x] 1.5 RED: `tests/shared/kernel/TenantContext.test.ts` — construction/equality
- [x] 1.6 GREEN: `src/shared/kernel/TenantContext.ts`
- [x] 1.7 RED: `tests/shared/kernel/AuthContext.test.ts` — shape `{userId, organizationId, isPlatformAdmin}`
- [x] 1.8 GREEN: `src/shared/kernel/AuthContext.ts`
- [x] 1.9 RED: `tests/shared/time/Instant.test.ts` + `Clock.test.ts` — `SystemClock` returns increasing `Instant`
- [x] 1.10 GREEN: `src/shared/time/{Instant,Clock,SystemClock}.ts`
- [x] 1.11 RED: `tests/shared/http/errorHandler.test.ts` — `DomainError` → `{error:{code,message,metadata}}` with status from `statusByCode`; non-domain error → `500 INTERNAL`, no leaked details (spec: Domain Error Envelope, both scenarios)
- [x] 1.12 GREEN: `src/shared/http/errorHandler.ts` (`createErrorHandler(statusByCode)`)
- [x] 1.13 RED: `tests/shared/http/pagination.test.ts` — `limit` defaults 25, caps at 100, returns `{items, nextCursor}` (spec: Cursor Pagination Contract)
- [x] 1.14 GREEN: `src/shared/http/pagination.ts`
- [x] 1.15 RED: `tests/shared/persistence/mongo/connect.test.ts` — non-replica-set Mongo aborts with actionable `--replSet rs0` hint (spec: App fails fast without a replica set) — requires real Mongo harness, mark integration
- [x] 1.16 GREEN: `src/shared/persistence/mongo/connect.ts` (connect + `hello().setName` assertion)
- [x] 1.17 RED: `tests/shared/persistence/mongo/ensureIndexes.test.ts` — creates `organizations.slug` unique, `users.{organizationId,email}` unique, `users.{organizationId,status}` (spec: Required Index Provisioning) — integration, real Mongo
- [x] 1.18 GREEN: `src/shared/persistence/mongo/ensureIndexes.ts`
- [ ] 1.19 Define `UnitOfWork`/`Transaction` port inline with domain ports work in Phase 2 (no standalone test — interface only, exercised via fakes in application tests) — INTENTIONALLY DEFERRED to PR 2 per this task's own description; not part of PR 1
- [x] 1.20 GREEN: `src/main.ts` — replace TODO with connect → assert replica set → `ensureIndexes` → build resolver/repos/use cases (none yet) → app factory → mount `/api/v1` → `errorHandler` last (added `src/shared/http/createApp.ts` as the reusable app-factory function this step calls, per the "Express App Bootstrap" requirement)
- [x] 1.21 Update `docs/MODELO_DATOS_MONGO.md` (`isPlatformAdmin` field) and `docs/ESTRUCTURA_REPO.md` (new `shared/{http,persistence}` folders) — both files are gitignored in this repo (`docs/` in `.gitignore`), so the edits are on disk but do not appear in the git diff

## Phase 2: Organizations Vertical Slice (PR 2)

- [ ] 2.1 RED: `tests/domain/organization/valueObjects.test.ts` — `OrganizationId`, `Slug`, `LifecycleStatus` guard invalid input with `INVARIANT_VIOLATION`
- [ ] 2.2 GREEN: `…/domain/model/value-objects/{OrganizationId,Slug,LifecycleStatus}.ts`
- [ ] 2.3 RED: `tests/domain/organization/valueObjects.transitionActor.test.ts` — `TransitionActor` VO carries `isPlatformAdmin`
- [ ] 2.4 GREEN: `…/domain/model/value-objects/TransitionActor.ts`
- [ ] 2.5 RED: `tests/domain/services/transitions.organization.test.ts` — full 4×4 `ORGANIZATION_TRANSITIONS` table-driven matrix (spec: Organization Status Transition Matrix, all 5 scenarios incl. no-op, DESHABILITADO cul-de-sac, platform-admin reactivation, forbidden reactivation)
- [ ] 2.6 GREEN: `…/domain/services/transitions.ts` (`ORGANIZATION_TRANSITIONS` table) + `StatusTransitionPolicy.ts` (`assertTransitionAllowed`)
- [ ] 2.7 RED: `tests/domain/errors/IdentityAccessError.test.ts` — closed `IdentityAccessErrorCode` union incl. `INVARIANT_VIOLATION`, `INVALID_TRANSITION`, `FORBIDDEN_REACTIVATION`, `ORGANIZATION_SLUG_TAKEN`, `ORGANIZATION_NOT_FOUND`
- [ ] 2.8 GREEN: `…/domain/errors/{IdentityAccessErrorCode,IdentityAccessError}.ts`
- [ ] 2.9 RED: `tests/domain/aggregates/Organization.test.ts` — `create`/`rehydrate`/`patchIdentity`/`transitionTo` return new immutable instances; `transitionTo` delegates to policy
- [ ] 2.10 GREEN: `…/domain/model/aggregates/Organization.ts`
- [ ] 2.11 RED: `tests/domain/ports/OrganizationRepository.test.ts` — port contract via an in-memory fake (save/findById/findBySlug/list-by-cursor)
- [ ] 2.12 GREEN: `…/domain/ports/OrganizationRepository.ts`
- [ ] 2.13 RED: `tests/application/organization/requirePlatformAdmin.test.ts` — non-platform-admin → `FORBIDDEN_CROSS_TENANT` before domain logic (spec: Organization Routes Require Platform-Admin, both scenarios)
- [ ] 2.14 GREEN: `…/application/authorization/requirePlatformAdmin.ts`
- [ ] 2.15 RED: `tests/application/organization/CreateOrganization.test.ts` — success + duplicate slug → `ORGANIZATION_SLUG_TAKEN` (in-memory fake repo)
- [ ] 2.16 GREEN: `…/application/CreateOrganization.ts`
- [ ] 2.17 RED: `tests/application/organization/{GetOrganization,ListOrganizations}.test.ts` — not-found → `ORGANIZATION_NOT_FOUND`; cursor list respects `limit`/`nextCursor`
- [ ] 2.18 GREEN: `…/application/{GetOrganization,ListOrganizations}.ts`
- [ ] 2.19 RED: `tests/application/organization/PatchOrganizationIdentity.test.ts` — only `name`/`domain`/`logoUrl` change, `slug` immutable
- [ ] 2.20 GREEN: `…/application/PatchOrganizationIdentity.ts`
- [ ] 2.21 RED: `tests/application/organization/TransitionOrganizationStatus.test.ts` — delegates to `StatusTransitionPolicy`; forbidden reactivation surfaces before persistence write (in-memory `UnitOfWork` fake)
- [ ] 2.22 GREEN: `…/application/TransitionOrganizationStatus.ts`
- [ ] 2.23 RED: `tests/application/organization/DeleteOrganization.test.ts` — asserts `DeleteOrganization` invokes the identical operation as transition-to-`DESHABILITADO` (spec: Soft Delete as Status Transition, both scenarios)
- [ ] 2.24 GREEN: `…/application/DeleteOrganization.ts` (delegates to `TransitionOrganizationStatus`)
- [ ] 2.25 RED: `tests/contract/organization/organizationSchemas.test.ts` — zod DTOs reject invalid payloads; patch allow-list enforced
- [ ] 2.26 GREEN: `…/infrastructure/adapters/inbound/http/dto/organizationSchemas.ts` + `mappers/OrganizationHttpMapper.ts`
- [ ] 2.27 RED: `tests/contract/organization/errorStatus.test.ts` — `errorStatus` map: `INVALID_TRANSITION` 422, `FORBIDDEN_REACTIVATION`/`FORBIDDEN_CROSS_TENANT` 403, `*_TAKEN` 409, `*_NOT_FOUND` 404, `INVARIANT_VIOLATION` 400, else 500
- [ ] 2.28 GREEN: `…/infrastructure/adapters/inbound/http/errorStatus.ts`
- [ ] 2.29 RED: `tests/integration/organization/mongoOrganizationRepository.test.ts` — duplicate-key on `slug_unique` translates to `ORGANIZATION_SLUG_TAKEN` by index name, never message parsing (real replica-set Mongo)
- [ ] 2.30 GREEN: `…/infrastructure/adapters/outbound/mongo/{BaseMongoRepository,MongoOrganizationRepository,documents,OrganizationDocumentMapper,duplicateKey,indexes}.ts`
- [ ] 2.31 RED: `tests/integration/organization/organizationRouter.test.ts` — supertest end-to-end for all 6 routes incl. read-unknown → 404, cross-tenant guard, cursor pagination page-size scenario
- [ ] 2.32 GREEN: `…/infrastructure/adapters/inbound/http/organizationRouter.ts`
- [ ] 2.33 Wire `organizationRouter` into the PR-1 app factory / `main.ts` mount point

## Phase 3: Users Vertical Slice & Cross-Tenant Bootstrap (PR 3)

- [ ] 3.1 RED: `tests/domain/user/valueObjects.test.ts` — `UserId`, `Email`, `PasswordCredential` guard invalid input with `INVARIANT_VIOLATION`
- [ ] 3.2 GREEN: `…/domain/model/value-objects/{UserId,Email,PasswordCredential}.ts`
- [ ] 3.3 RED: `tests/domain/services/transitions.user.test.ts` — full 4×4 `USER_TRANSITIONS` table-driven matrix, mirroring org matrix, incl. org-admin self-reactivation forbidden (spec: User Status Transition Matrix, all 5 scenarios)
- [ ] 3.4 GREEN: `…/domain/services/transitions.ts` — add `USER_TRANSITIONS` table (extends Phase 2 file)
- [ ] 3.5 RED: `tests/domain/aggregates/User.test.ts` — `create`/`rehydrate`/`patchIdentity`/`transitionTo` immutable, delegates to shared `StatusTransitionPolicy`
- [ ] 3.6 GREEN: `…/domain/model/aggregates/User.ts`
- [ ] 3.7 RED: `tests/domain/ports/{UserRepository,UserRepositoryFactory}.test.ts` — port contracts via in-memory fakes; `UserRepositoryFactory.forTenant(orgId)` returns a repo bound to that tenant (D8)
- [ ] 3.8 GREEN: `…/domain/ports/{UserRepository,UserRepositoryFactory}.ts`
- [ ] 3.9 RED: `tests/application/user/CreateUser.test.ts` — tenant-scoped creation, scrypt hash produced, duplicate email within org → `USER_EMAIL_TAKEN`, same email across orgs allowed (spec: Tenant-Scoped User Creation, both scenarios)
- [ ] 3.10 GREEN: `…/application/CreateUser.ts` + `…/infrastructure/adapters/outbound/crypto/ScryptPasswordHasher.ts` + `…/domain/ports/PasswordHasher.ts`
- [ ] 3.11 RED: `tests/application/user/{GetUser,ListUsers}.test.ts` — tenant isolation on read/list (spec: Tenant Isolation, cross-tenant-read and list-never-leaks scenarios)
- [ ] 3.12 GREEN: `…/application/{GetUser,ListUsers}.ts`
- [ ] 3.13 RED: `tests/application/user/PatchUserIdentity.test.ts` — allow-list `firstName/lastName/email/avatarUrl` only; rejects `roleIds`/`mfa`/security fields; email-conflict → `USER_EMAIL_TAKEN`; cross-tenant patch rejected (spec: User Identity Patch + Tenant Isolation cross-tenant-patch scenario)
- [ ] 3.14 GREEN: `…/application/PatchUserIdentity.ts`
- [ ] 3.15 RED: `tests/application/user/TransitionUserStatus.test.ts` — domain-level reactivation gate independent of route authz: org-admin authorized to call the use case still gets `FORBIDDEN_REACTIVATION` before persistence (spec: Reactivation Requires Platform-Admin at the Domain Level); cross-tenant transition rejected
- [ ] 3.16 GREEN: `…/application/TransitionUserStatus.ts`
- [ ] 3.17 RED: `tests/application/user/DeleteUser.test.ts` — identical to transition-to-`DESHABILITADO` (spec: Soft Delete as Status Transition, both scenarios)
- [ ] 3.18 GREEN: `…/application/DeleteUser.ts` (delegates to `TransitionUserStatus`)
- [ ] 3.19 RED: `tests/application/bootstrap/CreateOrganizationWithAdmin.test.ts` — atomic success (spec: Successful bootstrap); duplicate slug aborts whole transaction, no admin created (Duplicate slug scenario); duplicate admin email aborts, no org created (Duplicate admin email scenario); asserts a repo bound to the **new** org via `UserRepositoryFactory.forTenant`, not the caller's tenant (D8) — in-memory `UnitOfWork` fake that can force mid-transaction rollback
- [ ] 3.20 GREEN: `…/application/CreateOrganizationWithAdmin.ts`
- [ ] 3.21 RED: `tests/contract/user/userSchemas.test.ts` — zod DTOs reject invalid payloads; patch allow-list enforced at the DTO boundary too
- [ ] 3.22 GREEN: `…/infrastructure/adapters/inbound/http/dto/userSchemas.ts` + `mappers/UserHttpMapper.ts`
- [ ] 3.23 RED: `tests/contract/auth/authContext.test.ts` — `TrustedHeaderAuthContextResolver` reads `x-actor-*` headers only when `AUTH_MODE=trusted-header`; startup throws if `NODE_ENV=production` and mode is `trusted-header` (spec: D4 fail-closed production check — dedicated startup test)
- [ ] 3.24 GREEN: `…/infrastructure/adapters/inbound/http/auth/{AuthContextResolver,TrustedHeaderAuthContextResolver,authContextMiddleware}.ts`
- [ ] 3.25 RED: `tests/integration/user/mongoUserRepository.test.ts` — `MongoUserRepository(tenant, db)` scopes every query by bound tenant; duplicate-key on `user_email_unique` translates to `USER_EMAIL_TAKEN` by index name (real replica-set Mongo)
- [ ] 3.26 GREEN: `…/infrastructure/adapters/outbound/mongo/{MongoUserRepository,UserDocumentMapper,MongoUnitOfWork}.ts` + `UserRepositoryFactory` adapter
- [ ] 3.27 RED: `tests/integration/user/userRouter.test.ts` — supertest end-to-end for all users routes incl. tenant isolation (cross-tenant read/list/patch/transition scenarios), reactivation gate, patch allow-list at the wire level
- [ ] 3.28 GREEN: `…/infrastructure/adapters/inbound/http/userRouter.ts`
- [ ] 3.29 RED: `tests/integration/bootstrap/organizationBootstrap.test.ts` — real replica-set Mongo: transaction commits both documents or neither; verifies no partial state on forced failure
- [ ] 3.30 Wire `userRouter` + `CreateOrganizationWithAdmin` into `POST /organizations` route and the app factory / `main.ts` mount point

## Phase 4: Cross-Cutting Verification

- [ ] 4.1 Run full `npm test` suite; confirm all 32 transition-matrix cases (4×4×2 entities×2 actors) pass
- [ ] 4.2 Manual smoke: `node src/main.ts` against standalone (non-replica-set) Mongo — confirm fail-fast message with `--replSet rs0` hint
- [ ] 4.3 Confirm `tsc`/`eslint` pass clean across all three slices combined (config fixes already verified — no changes expected here)

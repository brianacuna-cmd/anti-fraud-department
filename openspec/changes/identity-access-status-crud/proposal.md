# Proposal: Identity-Access Organization & User CRUD with Status Lifecycle

## Intent

`identity-access` is empty (`.gitkeep` only) while every other module assumes tenants and users exist. Nothing can be built, seeded, or demoed without an organization and a user inside it. This change delivers the first real slice: organizations and users, both governed by one explicit status lifecycle, with soft-delete modeled as a status transition instead of a new schema field.

## Scope

### In Scope

- **Status enum** (identical for both): `ACTIVO`, `INACTIVO`, `SUSPENDIDO`, `DESHABILITADO` (terminal).
- **Transition matrix** as a lookup table (`ORGANIZATION_TRANSITIONS` / `USER_TRANSITIONS`), mirroring `CASE_TRANSITIONS` (Addendum §21.3):
  - `ACTIVO` → `INACTIVO`, `SUSPENDIDO`, `DESHABILITADO`
  - `INACTIVO` → `ACTIVO`, `SUSPENDIDO`, `DESHABILITADO`
  - `SUSPENDIDO` → `ACTIVO`, `INACTIVO`, `DESHABILITADO`
  - `DESHABILITADO` → `ACTIVO` **only** (reactivation) — every other pair, including `X→X` and `DESHABILITADO→INACTIVO`/`DESHABILITADO→SUSPENDIDO`, raises `INVALID_TRANSITION`.
  - **`DESHABILITADO→ACTIVO` is matrix-valid for both entities but actor-restricted**: only a `platform-admin` may trigger it, for organizations *and* for users — an org-admin can perform every other user transition but never this one, even inside their own organization (no self-reactivation). An org-admin attempting it gets `FORBIDDEN_REACTIVATION`, not `INVALID_TRANSITION` (the transition itself is valid; the actor isn't).
- **Endpoints** (`/api/v1`, cursor pagination per PRD §10):

  | Method / Path | Actor | Purpose |
  |---|---|---|
  | `POST /organizations` | platform-admin | atomic bootstrap: organization + first admin user |
  | `GET /organizations` | platform-admin | list |
  | `GET /organizations/:id` | platform-admin | read |
  | `PATCH /organizations/:id` | platform-admin | `name`, `domain`, `logoUrl` only |
  | `POST /organizations/:id/transition` | platform-admin | status change |
  | `DELETE /organizations/:id` | platform-admin | sugar → transition to `DESHABILITADO` |
  | `POST /users` | org admin | create user in caller's organization |
  | `GET /users` | org admin | list, tenant-scoped |
  | `GET /users/:id` | org admin | read |
  | `PATCH /users/:id` | org admin | `firstName`, `lastName`, `email`, `avatarUrl` only |
  | `POST /users/:id/transition` | org admin | status change |
  | `DELETE /users/:id` | org admin | sugar → transition to `DESHABILITADO` |

  `DELETE` is HTTP sugar: the handler calls the *same* application operation as `/transition` with `next = DESHABILITADO`, so it passes identical matrix validation and produces the same errors.
- **`platform-admin`**: minimal new additive boolean `isPlatformAdmin` on `users`, the only actor allowed to administer `organizations` cross-tenant. Enforced via the request-scoped auth context; no new collection, no permission system.
- **Atomic bootstrap** via a real Mongo multi-document transaction (replica set already assumed by Addendum §D.3) — an organization never exists without a user.
- **Closed `identity-access` error list** (new, module-owned): `INVALID_TRANSITION`, `FORBIDDEN_REACTIVATION`, `ORGANIZATION_SLUG_TAKEN`, `USER_EMAIL_TAKEN`, `ORGANIZATION_NOT_FOUND`, `USER_NOT_FOUND`, `FORBIDDEN_CROSS_TENANT`.
- **Minimal bootstrap wiring** — IN scope, sequenced first: Express 5 app factory, Mongo connection, index creation (`{slug:1}` unique, `{organizationId:1,email:1}` unique, `{organizationId:1,status:1}`), router mounting, `errorHandler` (`DomainError → {error:{code,message,metadata}}`, else `500 INTERNAL`). Without it nothing here is testable over HTTP; it is a prerequisite slice, not a separate change.
- Password hashing at creation using `node:crypto` `scrypt` (fills `passwordHash` + `passwordSalt`, adds no dependency).

### Out of Scope

- MFA endpoints (`mfa` subdocument untouched).
- Notification-preference endpoints.
- Role assignment (`roleIds` are opaque IDs; reassignment belongs to `access-control`, never imported here).
- Password change / reset / forgot flows, `resetToken*`, `loginAttempts`, `lockedUntil`, `lastLogin`.
- Login, JWT issuance, session creation.
- `organizations.configuration` editing, and `slug` mutation (immutable after creation).
- Provisioning the first platform-admin user.
- Hard delete, audit events / outbox emission for status changes.
- Self-service reactivation: an org-admin can never reactivate their own organization or a user in it — `DESHABILITADO→ACTIVO` is platform-admin-only, no exceptions.

## Capabilities

### New Capabilities

- `organization-lifecycle`: organization creation with first admin, read/list, identity patch, status transitions, soft-delete.
- `user-lifecycle`: tenant-scoped user CRUD, identity patch, status transitions, soft-delete.
- `platform-admin-authorization`: cross-tenant administration boundary and its enforcement rules.
- `http-api-foundation`: app bootstrap, error envelope, cursor pagination contract, index provisioning.

### Modified Capabilities

- None — `openspec/specs/` is empty; this is the first change.

## Approach

Hexagonal, per `docs/ESTANDAR_INGENIERIA_DOMINIO.md`:

1. **Domain** — `Organization` and `User` aggregates with branded `crypto.randomUUID()` IDs, immutable VOs (`Email`, `Slug`, `OrganizationStatus`, `UserStatus`), guard clauses, `max-depth: 1`. Transitions are table lookups returning a new instance; no `if`/`switch` cascades, no I/O, no zod.
2. **Application** — one use case per operation. `ChangeOrganizationStatus` / `ChangeUserStatus` are shared by both the `/transition` and `DELETE` routes. `CreateOrganizationWithAdmin` owns the transaction boundary.
3. **Infrastructure** — Mongo repositories behind domain ports. `UserRepository` binds `TenantContext` in its constructor (Addendum §C.4); `OrganizationRepository` does **not** — it is the tenant root and is instead gated by the platform-admin check. Uniqueness is enforced by the Mongo unique index; the repository translates duplicate-key errors into `ORGANIZATION_SLUG_TAKEN` / `USER_EMAIL_TAKEN` (domain has no I/O, Addendum §25.1). zod validates DTOs in inbound mappers only.

Strict TDD: RED → GREEN → REFACTOR per unit, domain-first.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/modules/identity-access/domain/**` | New | aggregates, VOs, transition tables, ports, closed error list |
| `src/modules/identity-access/application/**` | New | use cases incl. transactional bootstrap |
| `src/modules/identity-access/infrastructure/**` | New | Express routers, mappers, Mongo repositories |
| `src/shared/kernel/**` | New | branded ID + `DomainError` base, `TenantContext` / auth context |
| `src/main.ts` | Modified | replaces the TODO stub with real bootstrap |
| `tests/**` | New | domain, application, and integration tests |
| `docs/MODELO_DATOS_MONGO.md` | Modified | document the additive `isPlatformAdmin` field |
| `package.json` | Modified (likely) | Mongo integration test tooling only |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| No auth middleware / login exists, so `isPlatformAdmin` and `organizationId` have no real source | High | Define an auth-context port + a test/dev resolver now; real JWT middleware is a named follow-up change |
| First platform-admin cannot be created through any endpoint | High | Accepted: documented assumption; a seed script is a follow-up dependency |
| Mongo transaction requires a replica set; a standalone local Mongo fails at runtime | Medium | Fail fast at startup with a clear message; document the dev requirement |
| Bootstrap wiring + two aggregates exceed the 400-line review budget | High | `sdd-tasks` should slice: (1) bootstrap + shared kernel, (2) organizations, (3) users |
| `docs/ESTRUCTURA_REPO.md` is referenced by three docs but does not exist | Medium | Follow the existing `src/` folder layout as the de-facto structure; flag the doc gap |
| Status values are Spanish while code is English | Low | Accepted: fixed by the user; persist and expose the Spanish literals verbatim |

## Rollback Plan

The change is purely additive: no existing code, no data migration, no consumers. Revert the feature branch to restore `src/main.ts` to its TODO stub and leave `identity-access` empty. The only persisted side effects are new Mongo collections/indexes and the optional `isPlatformAdmin` field; drop `organizations` / `users` in a non-production environment, or leave them — no other module reads them yet.

## Dependencies

- Mongo running as a replica set (single-node is fine) for the bootstrap transaction.
- A follow-up change for authentication (login, JWT issuance, middleware) before these endpoints are usable by real clients.
- A seed/provisioning path for the first `isPlatformAdmin` user.

## Success Criteria

- [ ] `POST /api/v1/organizations` creates an organization and its first admin user, or neither, under one transaction.
- [ ] Every transition allowed by the matrix succeeds; every other pair, including `X→X` and any edge out of `DESHABILITADO` other than `→ACTIVO`, returns `INVALID_TRANSITION`.
- [ ] `DELETE /:id` and `POST /:id/transition` with `DESHABILITADO` are observably identical (same status, same errors).
- [ ] `DESHABILITADO→ACTIVO` succeeds only for a platform-admin actor; the same call from an org-admin (including on their own organization/users) returns `FORBIDDEN_REACTIVATION`, never a silent success.
- [ ] Duplicate `slug` / duplicate `email` within an organization return a domain error, never a raw Mongo error.
- [ ] Non-platform-admin callers are rejected on all `organizations` routes; user routes never read data outside the caller's `organizationId`.
- [ ] `PATCH /users/:id` cannot alter `roleIds`, `mfa`, `notificationPreferences`, or any password/security field.
- [ ] `npm test`, `npm run lint`, and `npm run typecheck` pass; the transition tables are covered by table-driven tests.

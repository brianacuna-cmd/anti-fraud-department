# User Lifecycle Specification

## Purpose

Defines tenant-scoped user creation, read, patch, and status-governed soft delete within an organization for the `identity-access` module.

## Requirements

### Requirement: User Status Transition Matrix

The system MUST govern `User.status` transitions through a lookup table (`USER_TRANSITIONS`), mirroring the organization matrix, never `if`/`switch` cascades.

Valid edges: `ACTIVO→{INACTIVO,SUSPENDIDO,DESHABILITADO}`, `INACTIVO→{ACTIVO,SUSPENDIDO,DESHABILITADO}`, `SUSPENDIDO→{ACTIVO,INACTIVO,DESHABILITADO}`, `DESHABILITADO→ACTIVO` (platform-admin only). Any pair not in this table, including `status→status` (no-op) and `DESHABILITADO→INACTIVO`/`DESHABILITADO→SUSPENDIDO`, MUST raise `INVALID_TRANSITION`.

`DESHABILITADO→ACTIVO` MUST succeed only when the acting user has `isPlatformAdmin = true`. An org-admin — even acting on a user inside their own organization — MUST receive `FORBIDDEN_REACTIVATION`, never a silent success and never `INVALID_TRANSITION`.

#### Scenario: Valid transition SUSPENDIDO to INACTIVO

- GIVEN a user with status `SUSPENDIDO`
- WHEN an org-admin requests transition to `INACTIVO`
- THEN the user status becomes `INACTIVO`

#### Scenario: No-op transition rejected

- GIVEN a user with status `ACTIVO`
- WHEN an org-admin requests transition to `ACTIVO`
- THEN the request fails with `INVALID_TRANSITION`

#### Scenario: Disabled user cannot move to a non-ACTIVO status

- GIVEN a user with status `DESHABILITADO`
- WHEN an org-admin requests transition to `SUSPENDIDO`
- THEN the request fails with `INVALID_TRANSITION`

#### Scenario: Org-admin cannot self-reactivate a user in their own organization

- GIVEN a user with status `DESHABILITADO` in the org-admin's own organization
- WHEN the org-admin requests transition to `ACTIVO`
- THEN the request fails with `FORBIDDEN_REACTIVATION`, not `INVALID_TRANSITION`

#### Scenario: Platform-admin reactivates a disabled user

- GIVEN a user with status `DESHABILITADO`
- AND the acting user has `isPlatformAdmin = true`
- WHEN a transition to `ACTIVO` is requested
- THEN the user status becomes `ACTIVO`

### Requirement: Tenant-Scoped User Creation

`POST /users` MUST create a user inside the caller's `organizationId` only, hashing the password with `node:crypto` `scrypt` (`passwordHash` + `passwordSalt`).

#### Scenario: Duplicate email within the same organization

- GIVEN a user already exists with `email = "a@x.com"` in organization `O1`
- WHEN an org-admin of `O1` creates another user with the same email
- THEN the request fails with `USER_EMAIL_TAKEN`

#### Scenario: Same email allowed across different organizations

- GIVEN a user exists with `email = "a@x.com"` in organization `O1`
- WHEN an org-admin of organization `O2` creates a user with the same email
- THEN the user is created successfully in `O2`

### Requirement: Tenant Isolation on Read, List, Patch, and Transition

Every `users` route MUST resolve data scoped to the caller's `organizationId` from the auth context. A request MUST NOT read or write a user belonging to a different organization.

#### Scenario: Cross-tenant read is rejected

- GIVEN a user `U1` belongs to organization `O1`
- WHEN an org-admin of organization `O2` requests `GET /users/:id` for `U1`
- THEN the request fails with `USER_NOT_FOUND` or `FORBIDDEN_CROSS_TENANT`, and `U1`'s data is never returned

#### Scenario: List never leaks other tenants

- GIVEN users exist in organizations `O1` and `O2`
- WHEN an org-admin of `O1` calls `GET /users`
- THEN only users belonging to `O1` are returned

#### Scenario: Cross-tenant transition and patch are rejected

- GIVEN a user `U1` belongs to organization `O1`
- WHEN an org-admin of organization `O2` calls `PATCH /users/:id` or `POST /users/:id/transition` for `U1`
- THEN the request fails with `USER_NOT_FOUND` or `FORBIDDEN_CROSS_TENANT`, and `U1` is unchanged

### Requirement: User Identity Patch

`PATCH /users/:id` MUST accept only `firstName`, `lastName`, `email`, `avatarUrl`. It MUST NOT alter `roleIds`, `mfa`, `notificationPreferences`, `passwordHash`, `passwordSalt`, `resetToken*`, `loginAttempts`, `lockedUntil`, or `lastLogin`.

#### Scenario: Patch rejects security and role fields

- GIVEN an existing user
- WHEN an org-admin submits `PATCH` including `roleIds` or `mfa`
- THEN those fields are ignored or the request is rejected, and only `firstName`/`lastName`/`email`/`avatarUrl` may change

#### Scenario: Email change conflicts within organization

- GIVEN a user `U2` exists in the same organization with `email = "taken@x.com"`
- WHEN an org-admin `PATCH`es another user's `email` to `"taken@x.com"`
- THEN the request fails with `USER_EMAIL_TAKEN`

### Requirement: Soft Delete as Status Transition

`DELETE /users/:id` MUST invoke the same application operation as `POST /users/:id/transition` with `next = DESHABILITADO`.

#### Scenario: DELETE and transition are observably identical

- GIVEN a user with status `ACTIVO` in the caller's organization
- WHEN an org-admin calls `DELETE /users/:id`
- THEN the response and resulting status equal calling `POST /users/:id/transition` with `{ next: "DESHABILITADO" }`

#### Scenario: DELETE on an already-disabled user fails the same way

- GIVEN a user with status `DESHABILITADO`
- WHEN an org-admin calls `DELETE /users/:id`
- THEN the request fails with `INVALID_TRANSITION`, identically to calling `/transition` with `next = DESHABILITADO`

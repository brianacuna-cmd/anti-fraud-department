# Organization Lifecycle Specification

## Purpose

Defines organization creation, read, patch, and status-governed soft delete as first-class transitions for the `identity-access` module.

## Requirements

### Requirement: Organization Status Transition Matrix

The system MUST govern `Organization.status` transitions through a lookup table (`ORGANIZATION_TRANSITIONS`), never `if`/`switch` cascades.

Valid edges: `ACTIVO→{INACTIVO,SUSPENDIDO,DESHABILITADO}`, `INACTIVO→{ACTIVO,SUSPENDIDO,DESHABILITADO}`, `SUSPENDIDO→{ACTIVO,INACTIVO,DESHABILITADO}`, `DESHABILITADO→ACTIVO` (platform-admin only). Any pair not in this table, including `status→status` (no-op) and `DESHABILITADO→INACTIVO`/`DESHABILITADO→SUSPENDIDO`, MUST raise `INVALID_TRANSITION`.

`DESHABILITADO→ACTIVO` MUST succeed only when the acting user has `isPlatformAdmin = true`; any other actor MUST receive `FORBIDDEN_REACTIVATION`, never a silent success and never `INVALID_TRANSITION`.

#### Scenario: Valid transition ACTIVO to SUSPENDIDO

- GIVEN an organization with status `ACTIVO`
- WHEN a platform-admin requests transition to `SUSPENDIDO`
- THEN the organization status becomes `SUSPENDIDO`

#### Scenario: No-op transition rejected

- GIVEN an organization with status `INACTIVO`
- WHEN a platform-admin requests transition to `INACTIVO`
- THEN the request fails with `INVALID_TRANSITION`

#### Scenario: Disabled organization cannot move to INACTIVO or SUSPENDIDO

- GIVEN an organization with status `DESHABILITADO`
- WHEN a platform-admin requests transition to `INACTIVO` or `SUSPENDIDO`
- THEN the request fails with `INVALID_TRANSITION`

#### Scenario: Platform-admin reactivates a disabled organization

- GIVEN an organization with status `DESHABILITADO`
- AND the acting user has `isPlatformAdmin = true`
- WHEN a transition to `ACTIVO` is requested
- THEN the organization status becomes `ACTIVO`

#### Scenario: Non-platform-admin reactivation is forbidden

- GIVEN an organization with status `DESHABILITADO`
- AND the acting user does not have `isPlatformAdmin = true`
- WHEN a transition to `ACTIVO` is requested
- THEN the request fails with `FORBIDDEN_REACTIVATION`, not `INVALID_TRANSITION`

### Requirement: Atomic Organization Bootstrap

`POST /organizations` MUST create the organization and its first admin user inside one Mongo multi-document transaction: both persist or neither does.

#### Scenario: Successful bootstrap

- GIVEN a unique `slug` and a unique admin `email`
- WHEN a platform-admin submits an organization + admin payload
- THEN both the organization and the admin user are persisted
- AND the response returns the created organization

#### Scenario: Duplicate slug aborts the whole transaction

- GIVEN an existing organization with `slug = "acme"`
- WHEN a platform-admin submits a new organization with `slug = "acme"`
- THEN the request fails with `ORGANIZATION_SLUG_TAKEN`
- AND no admin user is created

#### Scenario: Duplicate admin email aborts the whole transaction

- GIVEN an existing user anywhere with the submitted admin `email`
- WHEN the bootstrap payload reuses that `email`
- THEN the request fails with `USER_EMAIL_TAKEN`
- AND no organization is created

### Requirement: Organization Read and List

`GET /organizations` and `GET /organizations/:id` MUST be available to platform-admins only, using cursor pagination.

#### Scenario: Read unknown organization

- GIVEN no organization exists with the requested id
- WHEN a platform-admin requests `GET /organizations/:id`
- THEN the request fails with `ORGANIZATION_NOT_FOUND`

### Requirement: Organization Identity Patch

`PATCH /organizations/:id` MUST accept only `name`, `domain`, `logoUrl`. `slug` MUST remain immutable after creation; any other field MUST be ignored or rejected.

#### Scenario: Patch updates allowed fields only

- GIVEN an existing organization
- WHEN a platform-admin submits `PATCH` with `name` and `logoUrl`
- THEN those fields are updated
- AND `slug` is unchanged

### Requirement: Soft Delete as Status Transition

`DELETE /organizations/:id` MUST invoke the same application operation as `POST /organizations/:id/transition` with `next = DESHABILITADO`, producing identical results and errors.

#### Scenario: DELETE and transition are observably identical

- GIVEN an organization with status `ACTIVO`
- WHEN a platform-admin calls `DELETE /organizations/:id`
- THEN the response and resulting status equal calling `POST /organizations/:id/transition` with `{ next: "DESHABILITADO" }`

#### Scenario: DELETE on an already-disabled organization fails the same way

- GIVEN an organization with status `DESHABILITADO`
- WHEN a platform-admin calls `DELETE /organizations/:id`
- THEN the request fails with `INVALID_TRANSITION`, identically to calling `/transition` with `next = DESHABILITADO`

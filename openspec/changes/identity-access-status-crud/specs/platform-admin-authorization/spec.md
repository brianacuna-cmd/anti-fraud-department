# Platform-Admin Authorization Specification

## Purpose

Defines the cross-tenant administration boundary — which actor flag unlocks which endpoints — and the errors raised for unauthorized attempts, without introducing a new permission system.

## Requirements

### Requirement: Platform-Admin Flag

`users` MUST carry an additive boolean `isPlatformAdmin` (default `false`). No separate collection or permission system is introduced by this change.

#### Scenario: Default user is not a platform-admin

- GIVEN a user created via `POST /users`
- THEN `isPlatformAdmin` is `false` unless explicitly provisioned otherwise

### Requirement: Organization Routes Require Platform-Admin

Every `organizations` route (`POST`, `GET`, `GET /:id`, `PATCH /:id`, `POST /:id/transition`, `DELETE /:id`) MUST reject any actor whose auth context does not have `isPlatformAdmin = true`, before any domain logic runs.

#### Scenario: Non-platform-admin rejected from organizations routes

- GIVEN an authenticated actor with `isPlatformAdmin = false`
- WHEN that actor calls any `organizations` endpoint
- THEN the request fails with `FORBIDDEN_CROSS_TENANT`

#### Scenario: Platform-admin permitted

- GIVEN an authenticated actor with `isPlatformAdmin = true`
- WHEN that actor calls any `organizations` endpoint
- THEN the request is authorized to proceed to domain logic

### Requirement: Reactivation Requires Platform-Admin at the Domain Level

`DESHABILITADO→ACTIVO`, for both organizations and users, MUST be gated by `isPlatformAdmin = true` inside the application use case, independent of route-level authorization, so any caller reaching the transition operation without that flag receives `FORBIDDEN_REACTIVATION`.

#### Scenario: Domain-level gate on user reactivation

- GIVEN an org-admin actor (`isPlatformAdmin = false`) already authorized to call `POST /users/:id/transition` for their own organization
- WHEN the requested `next` is `ACTIVO` and the target user's current status is `DESHABILITADO`
- THEN the use case returns `FORBIDDEN_REACTIVATION` before any persistence write occurs

### Requirement: User Routes Are Tenant-Scoped, Not Platform-Admin-Gated

`users` routes MUST authorize by organization membership (the caller's `organizationId`), not by `isPlatformAdmin`. A platform-admin has no implicit access to arbitrary organizations' users through these routes.

#### Scenario: Platform-admin flag does not bypass tenant scoping on user routes

- GIVEN an actor with `isPlatformAdmin = true` and `organizationId = O1`
- WHEN that actor calls `GET /users/:id` for a user belonging to organization `O2`
- THEN the request fails with `USER_NOT_FOUND` or `FORBIDDEN_CROSS_TENANT`

# HTTP API Foundation Specification

## Purpose

Defines the bootstrap wiring, error envelope, cursor pagination contract, and index provisioning shared by every `identity-access` endpoint.

## Requirements

### Requirement: Express App Bootstrap

The system MUST provide an app factory (Express 5) that wires the Mongo connection, mounts `identity-access` routers under `/api/v1`, and registers the error handler before the app starts listening.

#### Scenario: App fails fast without a replica set

- GIVEN Mongo is running as a standalone (non-replica-set) instance
- WHEN the app attempts the bootstrap transaction path (`POST /organizations`)
- THEN the call fails with a clear, actionable error message rather than an ambiguous driver error

### Requirement: Domain Error Envelope

Any thrown `DomainError` MUST be serialized as `{ error: { code, message, metadata } }` with an HTTP status derived from its code. Any non-domain error MUST map to `500 INTERNAL` and MUST NOT leak raw driver/Mongo error details to the client.

#### Scenario: Domain error is serialized correctly

- GIVEN a use case throws a `DomainError` with code `ORGANIZATION_SLUG_TAKEN`
- WHEN the error reaches the error handler
- THEN the HTTP response body is `{ "error": { "code": "ORGANIZATION_SLUG_TAKEN", "message": ..., "metadata": ... } }`

#### Scenario: Mongo duplicate-key error never reaches the client

- GIVEN a Mongo unique index violation occurs on `{slug:1}` or `{organizationId:1,email:1}`
- WHEN the repository catches the duplicate-key error
- THEN it is translated to `ORGANIZATION_SLUG_TAKEN` or `USER_EMAIL_TAKEN` before leaving the infrastructure layer
- AND the client never observes a raw Mongo error code or message

### Requirement: Cursor Pagination Contract

`GET /organizations` and `GET /users` MUST support cursor-based pagination (PRD §10) rather than offset-based pagination.

#### Scenario: List respects cursor and page size

- GIVEN more results exist than the requested page size
- WHEN a client requests a list endpoint with a page-size limit
- THEN the response includes only that many items plus a cursor usable to fetch the next page

### Requirement: Required Index Provisioning

The system MUST provision, at bootstrap, a unique index on `organizations.slug`, a unique compound index on `users.{organizationId,email}`, and a compound index on `users.{organizationId,status}`.

#### Scenario: Indexes exist before the first request is served

- GIVEN a fresh Mongo database
- WHEN the app bootstrap completes
- THEN the three required indexes exist on their respective collections

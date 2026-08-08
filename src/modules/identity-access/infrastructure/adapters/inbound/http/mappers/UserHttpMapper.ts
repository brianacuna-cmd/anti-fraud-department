import type { User } from '../../../../../domain/model/aggregates/User.js';
import type { UserListPage } from '../../../../../domain/ports/UserRepository.js';
import type { SetupMfaResult } from '../../../../../application/SetupMfa.js';
import type { ActivateMfaResult } from '../../../../../application/ActivateMfa.js';

/** `resetToken`/`mfa` are persistence/domain-only and never appear here (design A11). */
export interface UserResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly lastName: string;
  readonly avatarUrl: string | null;
  readonly status: string;
  readonly isPlatformAdmin: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserListResponseDto {
  readonly items: readonly UserResponseDto[];
  readonly nextCursor: string | null;
}

/** Deliberately excludes `credential` (passwordHash/passwordSalt) — never leaves the server. */
export function toUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    firstName: user.firstName,
    middleName: user.middleName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    status: user.status,
    isPlatformAdmin: user.isPlatformAdmin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function toUserListResponse(page: UserListPage): UserListResponseDto {
  return {
    items: page.items.map(toUserResponse),
    nextCursor: page.nextCursor,
  };
}

/** POST /users/me/mfa/setup response body (mfa-user-enrollment PR2). No raw secret — the QR/otpauth URI carry it. */
export interface MfaSetupResponseDto {
  readonly qrCodeDataUrl: string;
  readonly otpauthUri: string;
}

export function toMfaSetupResponse(result: SetupMfaResult): MfaSetupResponseDto {
  return { qrCodeDataUrl: result.qrCodeDataUrl, otpauthUri: result.otpauthUri };
}

/**
 * POST /users/me/mfa/activate response body (two-step-login PR3, design D4).
 * `session` is non-null ONLY for the forced-enrollment hand-off — a
 * self-service `'full'`-scope caller already has a session, so it stays
 * `null` and the shape matches PR2's plain-user response in substance.
 */
export interface ActivateMfaResponseDto {
  readonly user: UserResponseDto;
  readonly session: { readonly accessToken: string; readonly refreshToken: string; readonly expiresAt: string } | null;
}

export function toActivateMfaResponse(result: ActivateMfaResult): ActivateMfaResponseDto {
  return {
    user: toUserResponse(result.user),
    session: result.session
      ? { accessToken: result.session.accessToken, refreshToken: result.session.refreshToken, expiresAt: result.session.expiresAt }
      : null,
  };
}

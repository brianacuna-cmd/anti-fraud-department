import type { User } from '../../../../../domain/model/aggregates/User.js';
import type { UserListPage } from '../../../../../domain/ports/UserRepository.js';

export interface UserResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly firstName: string;
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

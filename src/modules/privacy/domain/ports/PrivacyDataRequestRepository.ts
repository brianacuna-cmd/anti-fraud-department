import type { PrivacyDataRequest } from '../model/aggregates/PrivacyDataRequest.js';
import type { PrivacyDataRequestId } from '../model/value-objects/PrivacyDataRequestId.js';
import type { PrivacyRequestStatus } from '../model/value-objects/PrivacyRequestStatus.js';
import type { PrivacyRequestType } from '../model/value-objects/PrivacyRequestType.js';
import type { Transaction } from './UnitOfWork.js';

export interface PrivacyDataRequestListQuery {
  readonly organizationId: string;
  readonly status?: readonly PrivacyRequestStatus[];
  readonly type?: readonly PrivacyRequestType[];
  readonly limit: number;
  readonly offset: number;
}

export interface PrivacyDataRequestListResult {
  readonly items: readonly PrivacyDataRequest[];
  readonly total: number;
}

export interface PrivacyDataRequestRepository {
  save(request: PrivacyDataRequest, tx?: Transaction): Promise<void>;
  findById(id: PrivacyDataRequestId, tx?: Transaction): Promise<PrivacyDataRequest | null>;
  list(
    query: PrivacyDataRequestListQuery,
    tx?: Transaction,
  ): Promise<PrivacyDataRequestListResult>;
}

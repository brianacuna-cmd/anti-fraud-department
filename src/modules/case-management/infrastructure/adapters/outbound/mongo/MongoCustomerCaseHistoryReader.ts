import { ObjectId, type Collection, type Db, type Document } from 'mongodb';
import { ACTIVE_CASE_STATUSES } from '../../../../domain/ports/CaseRepository.js';
import type {
  CustomerCaseHistory,
  CustomerCaseHistoryQuery,
  CustomerCaseHistoryReader,
} from '../../../../domain/ports/CustomerCaseHistoryReader.js';
import type { CaseDocument } from './documents/CaseDocument.js';

/**
 * One grouped count over the customer's cases. The `$or` over the three
 * identifiers is served by the per-identifier tenant indexes
 * (`case_org_customer_idx`, `case_org_stripe_customer_idx`,
 * `case_org_bridge_user_idx`).
 */
export class MongoCustomerCaseHistoryReader implements CustomerCaseHistoryReader {
  private readonly cases: Collection<CaseDocument>;

  constructor(db: Db) {
    this.cases = db.collection<CaseDocument>('cases');
  }

  async countByCustomer(query: CustomerCaseHistoryQuery): Promise<CustomerCaseHistory> {
    const ids = [...new Set([query.customerId, ...(query.alsoKnownAs ?? [])])];
    const match: Document = {
      organization_id: new ObjectId(query.organizationId),
      deleted_at: null,
      $or: [
        { customer_id: { $in: ids } },
        { stripe_customer_id: { $in: ids } },
        { bridge_user_id: { $in: ids } },
      ],
    };
    if (query.excludeCaseId !== undefined) {
      match._id = { $ne: new ObjectId(query.excludeCaseId) };
    }
    const countIf = (condition: Document) => ({ $sum: { $cond: [condition, 1, 0] } });

    const [row] = await this.cases
      .aggregate<CustomerCaseHistory>([
        { $match: match },
        {
          $group: {
            _id: null,
            previousCases: { $sum: 1 },
            openCases: countIf({ $in: ['$status', [...ACTIVE_CASE_STATUSES]] }),
            fraudConfirmedCases: countIf({ $eq: ['$resolution_outcome', 'FRAUD_CONFIRMED'] }),
            falsePositiveCases: countIf({ $eq: ['$resolution_outcome', 'FALSE_POSITIVE'] }),
          },
        },
        { $project: { _id: 0 } },
      ])
      .toArray();

    return row ?? { previousCases: 0, openCases: 0, fraudConfirmedCases: 0, falsePositiveCases: 0 };
  }
}

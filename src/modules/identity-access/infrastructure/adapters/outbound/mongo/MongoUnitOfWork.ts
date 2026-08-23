import type { Transaction, UnitOfWork } from '../../../../domain/ports/UnitOfWork.js';
import { MongoUnitOfWorkBase } from '../../../../../../shared/persistence/mongo/MongoUnitOfWorkBase.js';

/**
 * Production `UnitOfWork` backed by a REAL Mongo `ClientSession` (design D6)
 * — required for `CreateOrganizationWithAdmin`'s genuine cross-collection
 * atomicity. Deliberately NOT reused from Phase 2's `PassthroughUnitOfWork`
 * (that adapter never opens a session at all, correct only for
 * single-aggregate writes).
 */
export class MongoUnitOfWork extends MongoUnitOfWorkBase<Transaction> implements UnitOfWork {}

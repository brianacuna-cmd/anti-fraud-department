import type { Transaction, UnitOfWork } from '../../../../domain/ports/UnitOfWork.js';
import { MongoUnitOfWorkBase } from '../../../../../../shared/persistence/mongo/MongoUnitOfWorkBase.js';

/**
 * Production `UnitOfWork` backed by a REAL Mongo `ClientSession` (mirrors
 * identity-access's `MongoUnitOfWork`) — required for case-management's
 * multi-collection transactional use cases (T1/T2/T4/T5/T6, later slices).
 */
export class MongoUnitOfWork extends MongoUnitOfWorkBase<Transaction> implements UnitOfWork {}

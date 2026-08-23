import type { Transaction, UnitOfWork } from '../../../../domain/ports/UnitOfWork.js';
import { MongoUnitOfWorkBase } from '../../../../../../shared/persistence/mongo/MongoUnitOfWorkBase.js';

/**
 * Production `UnitOfWork` backed by a REAL Mongo `ClientSession` (clone of
 * case-management's `MongoUnitOfWork`) — required for atomic activate swap.
 */
export class MongoUnitOfWork extends MongoUnitOfWorkBase<Transaction> implements UnitOfWork {}

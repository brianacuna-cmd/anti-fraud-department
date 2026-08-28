import type { Transaction, UnitOfWork } from '../../../../domain/ports/UnitOfWork.js';
import { MongoUnitOfWorkBase } from '../../../../../../shared/persistence/mongo/MongoUnitOfWorkBase.js';

/** Production `UnitOfWork` backed by a REAL Mongo `ClientSession`. */
export class MongoUnitOfWork extends MongoUnitOfWorkBase<Transaction> implements UnitOfWork {}

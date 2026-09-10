import type { Transaction, UnitOfWork } from '../../../../domain/ports/UnitOfWork.js';
import { MongoUnitOfWorkBase } from '../../../../../../shared/persistence/mongo/MongoUnitOfWorkBase.js';

/** `UnitOfWork` de producción, sobre una `ClientSession` real de Mongo. */
export class MongoUnitOfWork extends MongoUnitOfWorkBase<Transaction> implements UnitOfWork {}

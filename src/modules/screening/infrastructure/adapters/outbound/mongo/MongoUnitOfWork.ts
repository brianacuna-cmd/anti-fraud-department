import type { Transaction, UnitOfWork } from '../../../../domain/ports/UnitOfWork.js';
import { MongoUnitOfWorkBase } from '../../../../../../shared/persistence/mongo/MongoUnitOfWorkBase.js';

/**
 * Production `UnitOfWork` backed by a real Mongo `ClientSession`. Required
 * so `OpenAmlAlert`'s `aml_alerts` + `case_timeline` + `outbox_events`
 * writes commit or roll back together.
 */
export class MongoUnitOfWork extends MongoUnitOfWorkBase<Transaction> implements UnitOfWork {}

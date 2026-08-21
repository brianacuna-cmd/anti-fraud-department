import type { Transaction, UnitOfWork } from '../../../../domain/ports/UnitOfWork.js';
import { MongoUnitOfWorkBase } from '../../../../../../shared/persistence/mongo/MongoUnitOfWorkBase.js';

/**
 * Production `UnitOfWork` backed by a REAL Mongo `ClientSession` (design
 * D11), copied verbatim from identity-access's own `MongoUnitOfWork` — this
 * module owns its own instance since a module may not import another
 * module's infrastructure (eslint `boundaries`). Required (not a
 * passthrough): the preference upsert row and the `AuditLogs` row must
 * commit or roll back together.
 */
export class MongoUnitOfWork extends MongoUnitOfWorkBase<Transaction> implements UnitOfWork {}

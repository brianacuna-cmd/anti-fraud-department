import type { Transaction, UnitOfWork } from '../domain/ports/UnitOfWork.js';

/** `UnitOfWork` para tests: ejecuta `work` contra un handle opaco. */
export class PassthroughUnitOfWork implements UnitOfWork {
  private readonly fakeTransaction = {} as Transaction;

  async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return work(this.fakeTransaction);
  }
}

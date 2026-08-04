import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';

describe('UnitOfWork (port contract, via InMemoryUnitOfWork fake)', () => {
  it('runs the given work against an opaque transaction handle and returns its result', async () => {
    const unitOfWork = new InMemoryUnitOfWork();

    const result = await unitOfWork.withTransaction(async (tx) => {
      expect(tx).toBeDefined();
      return 'work-result';
    });

    expect(result).toBe('work-result');
  });

  it('invokes work exactly once per withTransaction call, even across two calls', async () => {
    const unitOfWork = new InMemoryUnitOfWork();

    await unitOfWork.withTransaction(async () => 'first');
    await unitOfWork.withTransaction(async () => 'second');

    expect(unitOfWork.transactionCount).toBe(2);
  });
});

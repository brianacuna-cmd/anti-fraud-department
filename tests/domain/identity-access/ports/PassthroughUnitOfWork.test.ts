import { PassthroughUnitOfWork } from '../../../../src/modules/identity-access/infrastructure/PassthroughUnitOfWork.js';

describe('PassthroughUnitOfWork', () => {
  it('runs the given work against an opaque transaction handle and returns its result', async () => {
    const unitOfWork = new PassthroughUnitOfWork();

    const result = await unitOfWork.withTransaction(async (tx) => {
      expect(tx).toBeDefined();
      return 42;
    });

    expect(result).toBe(42);
  });

  it('propagates a rejection from the given work unchanged', async () => {
    const unitOfWork = new PassthroughUnitOfWork();

    await expect(
      unitOfWork.withTransaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

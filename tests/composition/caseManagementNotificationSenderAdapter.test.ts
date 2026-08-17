import { oid } from '../support/oid.js';
import { createCaseManagementNotificationSenderAdapter } from '../../src/composition/caseManagementNotificationSenderAdapter.js';
import type { createSendNotificationUseCase } from '../../src/modules/notifications/application/SendNotification.js';
import type { Transaction } from '../../src/modules/case-management/domain/ports/UnitOfWork.js';

describe('createCaseManagementNotificationSenderAdapter', () => {
  it('delegates to sendNotification with domain-typed fields', async () => {
    const calls: unknown[] = [];
    const sendNotification = (async (input: unknown) => {
      calls.push(input);
    }) as unknown as ReturnType<typeof createSendNotificationUseCase>;

    const sender = createCaseManagementNotificationSenderAdapter(sendNotification);
    await sender.send({
      organizationId: oid('org-1'),
      recipientUserId: oid('user-1'),
      alertType: 'CASO_ASIGNADO',
      context: { caseId: oid('case-1') },
    });

    expect(calls).toEqual([
      {
        organizationId: oid('org-1'),
        recipientUserId: oid('user-1'),
        alertType: 'CASO_ASIGNADO',
        context: { caseId: oid('case-1') },
      },
    ]);
  });

  it('casts and threads the same tx reference through', async () => {
    const seenTx: unknown[] = [];
    const sendNotification = (async (_input: unknown, tx?: unknown) => {
      seenTx.push(tx);
    }) as unknown as ReturnType<typeof createSendNotificationUseCase>;
    const tx = {} as Transaction;

    const sender = createCaseManagementNotificationSenderAdapter(sendNotification);
    await sender.send(
      { organizationId: oid('org-1'), recipientUserId: oid('user-1'), alertType: 'CASO_ASIGNADO', context: {} },
      tx,
    );

    expect(seenTx[0]).toBe(tx);
  });

  it('omits tx when the caller sends without a transaction', async () => {
    const seenTx: unknown[] = [];
    const sendNotification = (async (_input: unknown, tx?: unknown) => {
      seenTx.push(tx);
    }) as unknown as ReturnType<typeof createSendNotificationUseCase>;

    const sender = createCaseManagementNotificationSenderAdapter(sendNotification);
    await sender.send({
      organizationId: oid('org-1'),
      recipientUserId: oid('user-1'),
      alertType: 'CASO_ASIGNADO',
      context: {},
    });

    expect(seenTx[0]).toBeUndefined();
  });
});

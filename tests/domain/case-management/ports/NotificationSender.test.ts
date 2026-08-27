import type { NotificationRequest, NotificationSender } from '../../../../src/modules/case-management/domain/ports/NotificationSender.js';
import type { Transaction } from '../../../../src/modules/case-management/domain/ports/UnitOfWork.js';

describe('NotificationSender port (structural twin of AuditRecorder)', () => {
  it('accepts an implementation with send(request, tx?)', async () => {
    const calls: { request: NotificationRequest; tx?: Transaction }[] = [];
    const sender: NotificationSender = {
      async send(request, tx) {
        calls.push({ request, tx });
      },
    };

    await sender.send({
      organizationId: 'org-1',
      recipientUserId: 'user-1',
      alertType: 'CASE_ASSIGNED',
      context: { caseId: 'case-1' },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.request.alertType).toBe('CASE_ASSIGNED');
    expect(calls[0]?.tx).toBeUndefined();
  });
});

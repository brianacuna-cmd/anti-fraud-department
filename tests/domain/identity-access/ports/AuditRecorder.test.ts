import { oid } from '../../../support/oid.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import type { AuditEvent } from '../../../../src/modules/identity-access/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/identity-access/domain/ports/UnitOfWork.js';

const EVENT: AuditEvent = {
  organizationId: oid('org-1'),
  actorType: 'USER',
  actorId: oid('user-1'),
  action: 'USER_CREATED',
  resource: 'users',
  resourceId: oid('user-2'),
  detail: { field: 'value' },
  ipAddress: '127.0.0.1',
};

describe('InMemoryAuditRecorder', () => {
  it('captures a recorded event', async () => {
    const recorder = new InMemoryAuditRecorder();

    await recorder.record(EVENT);

    expect(recorder.all()).toEqual([EVENT]);
  });

  it('captures whether a tx was threaded through', async () => {
    const recorder = new InMemoryAuditRecorder();
    const tx = {} as Transaction;

    await recorder.record(EVENT, tx);

    expect(recorder.calls()[0]?.tx).toBe(tx);
  });

  it('captures a call with no tx (login path, design "Login atomicity caveat")', async () => {
    const recorder = new InMemoryAuditRecorder();

    await recorder.record(EVENT);

    expect(recorder.calls()[0]?.tx).toBeUndefined();
  });
});

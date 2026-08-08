import { createAuditRecorderAdapter } from '../../src/composition/auditRecorderAdapter.js';
import type { createRecordAuditLogUseCase } from '../../src/modules/audit/application/RecordAuditLog.js';
import type { AuditEvent } from '../../src/modules/identity-access/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../src/modules/identity-access/domain/ports/UnitOfWork.js';

const EVENT: AuditEvent = {
  organizationId: 'org-1',
  actorType: 'USER',
  actorId: 'user-1',
  action: 'USER_CREATED',
  resource: 'users',
  resourceId: 'user-2',
  detail: { field: 'value' },
  ipAddress: '127.0.0.1',
};

describe('createAuditRecorderAdapter', () => {
  it('delegates to recordAuditLog with the widened plain-string command', async () => {
    const calls: unknown[] = [];
    const recordAuditLog = (async (cmd: unknown) => {
      calls.push(cmd);
    }) as unknown as ReturnType<typeof createRecordAuditLogUseCase>;

    const auditRecorder = createAuditRecorderAdapter(recordAuditLog);
    await auditRecorder.record(EVENT);

    expect(calls).toEqual([
      {
        organizationId: 'org-1',
        actorType: 'USER',
        actorId: 'user-1',
        action: 'USER_CREATED',
        resource: 'users',
        resourceId: 'user-2',
        detail: { field: 'value' },
        ipAddress: '127.0.0.1',
      },
    ]);
  });

  it('casts and threads the same tx reference through (design D-A4 single cast)', async () => {
    const seenTx: unknown[] = [];
    const recordAuditLog = (async (_cmd: unknown, tx?: unknown) => {
      seenTx.push(tx);
    }) as unknown as ReturnType<typeof createRecordAuditLogUseCase>;
    const tx = {} as Transaction;

    const auditRecorder = createAuditRecorderAdapter(recordAuditLog);
    await auditRecorder.record(EVENT, tx);

    expect(seenTx[0]).toBe(tx);
  });

  it('omits tx for the non-transactional login path', async () => {
    const seenTx: unknown[] = [];
    const recordAuditLog = (async (_cmd: unknown, tx?: unknown) => {
      seenTx.push(tx);
    }) as unknown as ReturnType<typeof createRecordAuditLogUseCase>;

    const auditRecorder = createAuditRecorderAdapter(recordAuditLog);
    await auditRecorder.record(EVENT);

    expect(seenTx[0]).toBeUndefined();
  });
});

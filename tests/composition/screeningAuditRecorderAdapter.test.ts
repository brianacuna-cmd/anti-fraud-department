import { oid } from '../support/oid.js';
import { createScreeningAuditRecorderAdapter } from '../../src/composition/screeningAuditRecorderAdapter.js';
import type { createRecordAuditLogUseCase } from '../../src/modules/audit/application/RecordAuditLog.js';
import type { AuditEvent } from '../../src/modules/screening/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../src/modules/screening/domain/ports/UnitOfWork.js';

const EVENT: AuditEvent = {
  organizationId: oid('org-1'),
  actorType: 'USER',
  actorId: oid('user-1'),
  action: 'RESOLVE_AML_ALERT',
  resource: 'aml_alert',
  resourceId: oid('alert-1'),
  detail: { verdict: 'CONFIRMED_MATCH', justification: 'Matched government ID.' },
  ipAddress: '127.0.0.1',
};

describe('createScreeningAuditRecorderAdapter', () => {
  it('delegates to recordAuditLog with the widened plain-string command', async () => {
    const calls: unknown[] = [];
    const recordAuditLog = (async (cmd: unknown) => {
      calls.push(cmd);
    }) as unknown as ReturnType<typeof createRecordAuditLogUseCase>;

    const auditRecorder = createScreeningAuditRecorderAdapter(recordAuditLog);
    await auditRecorder.record(EVENT);

    expect(calls).toEqual([
      {
        organizationId: oid('org-1'),
        actorType: 'USER',
        actorId: oid('user-1'),
        action: 'RESOLVE_AML_ALERT',
        resource: 'aml_alert',
        resourceId: oid('alert-1'),
        detail: { verdict: 'CONFIRMED_MATCH', justification: 'Matched government ID.' },
        ipAddress: '127.0.0.1',
      },
    ]);
  });

  it('casts and threads the same tx reference through', async () => {
    const seenTx: unknown[] = [];
    const recordAuditLog = (async (_cmd: unknown, tx?: unknown) => {
      seenTx.push(tx);
    }) as unknown as ReturnType<typeof createRecordAuditLogUseCase>;
    const tx = {} as Transaction;

    const auditRecorder = createScreeningAuditRecorderAdapter(recordAuditLog);
    await auditRecorder.record(EVENT, tx);

    expect(seenTx[0]).toBe(tx);
  });

  it('omits tx when recording without a transaction', async () => {
    const seenTx: unknown[] = [];
    const recordAuditLog = (async (_cmd: unknown, tx?: unknown) => {
      seenTx.push(tx);
    }) as unknown as ReturnType<typeof createRecordAuditLogUseCase>;

    const auditRecorder = createScreeningAuditRecorderAdapter(recordAuditLog);
    await auditRecorder.record(EVENT);

    expect(seenTx[0]).toBeUndefined();
  });
});

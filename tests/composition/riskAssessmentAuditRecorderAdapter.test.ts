import { oid } from '../support/oid.js';
import { createRiskAssessmentAuditRecorderAdapter } from '../../src/composition/riskAssessmentAuditRecorderAdapter.js';
import type { createRecordAuditLogUseCase } from '../../src/modules/audit/application/RecordAuditLog.js';
import type { AuditEvent } from '../../src/modules/risk-assessment/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../src/modules/risk-assessment/domain/ports/UnitOfWork.js';

const EVENT: AuditEvent = {
  organizationId: oid('org-1'),
  actorType: 'USER',
  actorId: oid('user-1'),
  action: 'CALCULATE_RISK_SCORE',
  resource: 'rule',
  resourceId: oid('rule-1'),
  detail: { riskScore: 72 },
  ipAddress: '127.0.0.1',
};

describe('createRiskAssessmentAuditRecorderAdapter', () => {
  it('delegates to recordAuditLog with the widened plain-string command', async () => {
    const calls: unknown[] = [];
    const recordAuditLog = (async (cmd: unknown) => {
      calls.push(cmd);
    }) as unknown as ReturnType<typeof createRecordAuditLogUseCase>;

    const auditRecorder = createRiskAssessmentAuditRecorderAdapter(recordAuditLog);
    await auditRecorder.record(EVENT);

    expect(calls).toEqual([
      {
        organizationId: oid('org-1'),
        actorType: 'USER',
        actorId: oid('user-1'),
        action: 'CALCULATE_RISK_SCORE',
        resource: 'rule',
        resourceId: oid('rule-1'),
        detail: { riskScore: 72 },
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

    const auditRecorder = createRiskAssessmentAuditRecorderAdapter(recordAuditLog);
    await auditRecorder.record(EVENT, tx);

    expect(seenTx[0]).toBe(tx);
  });

  it('omits tx when scoring records without a transaction', async () => {
    const seenTx: unknown[] = [];
    const recordAuditLog = (async (_cmd: unknown, tx?: unknown) => {
      seenTx.push(tx);
    }) as unknown as ReturnType<typeof createRecordAuditLogUseCase>;

    const auditRecorder = createRiskAssessmentAuditRecorderAdapter(recordAuditLog);
    await auditRecorder.record(EVENT);

    expect(seenTx[0]).toBeUndefined();
  });
});

import { ScheduledJob } from '../../../../src/shared/scheduled-jobs/ScheduledJob.js';
import { createScheduledJobId } from '../../../../src/shared/scheduled-jobs/ScheduledJobId.js';
import { createScheduledJobResult } from '../../../../src/shared/scheduled-jobs/ScheduledJobResult.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { oid } from '../../../support/oid.js';

const NOW = fromDate(new Date('2026-08-28T15:00:00.000Z'));
const NEXT = fromDate(new Date('2026-08-28T15:01:00.000Z'));

function freshJob(
  overrides: Partial<Parameters<typeof ScheduledJob.create>[0]> = {},
): ScheduledJob {
  return ScheduledJob.create({
    id: createScheduledJobId(oid('job-1')),
    organizationId: null,
    name: 'sla_sweep',
    description: 'Sweep SLA tracking rows',
    cronExpression: 'every 60s',
    now: NOW,
    ...overrides,
  });
}

describe('createScheduledJobResult', () => {
  it('accepts SUCCESS and FAILED', () => {
    expect(createScheduledJobResult('SUCCESS')).toBe('SUCCESS');
    expect(createScheduledJobResult('FAILED')).toBe('FAILED');
  });

  it('persists incoming ERROR as FAILED', () => {
    expect(createScheduledJobResult('ERROR')).toBe('FAILED');
  });

  it('rejects values outside SUCCESS, FAILED, and ERROR', () => {
    expect(() => createScheduledJobResult('PENDING')).toThrow('ScheduledJobResult');
  });
});

describe('ScheduledJob.create', () => {
  it('opens with null last_result, last_error, last_run_at and enabled true by default', () => {
    const job = freshJob();

    expect(job.name).toBe('sla_sweep');
    expect(job.organizationId).toBeNull();
    expect(job.enabled).toBe(true);
    expect(job.lastResult).toBeNull();
    expect(job.lastError).toBeNull();
    expect(job.lastRunAt).toBeNull();
    expect(job.nextRunAt).toBeNull();
    expect(job.createdAt).toBe(NOW);
  });

  it('persists enabled false when provided (does not gate ticks)', () => {
    const job = freshJob({ enabled: false });

    expect(job.enabled).toBe(false);
    expect(job.name).toBe('sla_sweep');
  });
});

describe('ScheduledJob.recordRun', () => {
  it('records SUCCESS and clears last_error on the same named job', () => {
    const recorded = freshJob().recordRun({
      result: 'SUCCESS',
      lastError: 'stale',
      nextRunAt: NEXT,
      now: NOW,
    });

    expect(recorded.name).toBe('sla_sweep');
    expect(recorded.id).toBe(createScheduledJobId(oid('job-1')));
    expect(recorded.lastResult).toBe('SUCCESS');
    expect(recorded.lastError).toBeNull();
    expect(recorded.lastRunAt).toBe(NOW);
    expect(recorded.nextRunAt).toBe(NEXT);
  });

  it('records FAILED with last_error on the same named job (one document identity)', () => {
    const recorded = freshJob().recordRun({
      result: 'FAILED',
      lastError: 'mongo timeout',
      nextRunAt: NEXT,
      now: NOW,
    });

    expect(recorded.name).toBe('sla_sweep');
    expect(recorded.id).toBe(createScheduledJobId(oid('job-1')));
    expect(recorded.lastResult).toBe('FAILED');
    expect(recorded.lastError).toBe('mongo timeout');
  });

  it('stores ERROR as FAILED without minting a second name', () => {
    const original = freshJob();
    const recorded = original.recordRun({
      result: 'ERROR',
      lastError: 'broker down',
      nextRunAt: NEXT,
      now: NOW,
    });

    expect(recorded.lastResult).toBe('FAILED');
    expect(recorded.name).toBe(original.name);
    expect(recorded.id).toBe(original.id);
  });

  it('does not mutate the original aggregate', () => {
    const original = freshJob();
    original.recordRun({ result: 'SUCCESS', lastError: null, nextRunAt: NEXT, now: NOW });

    expect(original.lastResult).toBeNull();
    expect(original.lastRunAt).toBeNull();
  });
});

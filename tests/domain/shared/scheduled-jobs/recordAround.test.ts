import { recordAround } from '../../../../src/shared/scheduled-jobs/recordAround.js';
import type {
  RecordScheduledJobRunInput,
  ScheduledJobRepository,
  SeedScheduledJobInput,
} from '../../../../src/shared/scheduled-jobs/ScheduledJobRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-08-28T15:00:00.000Z'));
const NEXT = fromDate(new Date('2026-08-28T15:01:00.000Z'));
const LAST_ERROR_LIMIT = 8 * 1024;

class FakeRecorder implements ScheduledJobRepository {
  readonly recordRunCalls: RecordScheduledJobRunInput[] = [];
  recordRunImpl: (input: RecordScheduledJobRunInput) => Promise<void> = async () => {
    /* default: succeed */
  };

  async seed(_input: SeedScheduledJobInput): Promise<void> {
    /* unused in recordAround */
  }

  async findByName(_name: string): Promise<null> {
    return null;
  }

  async recordRun(input: RecordScheduledJobRunInput): Promise<void> {
    this.recordRunCalls.push(input);
    await this.recordRunImpl(input);
  }
}

function meta(recorder: FakeRecorder, extras: { onRecorderError?: (e: unknown) => void } = {}) {
  return {
    name: 'sla_sweep',
    recorder,
    clock: new FixedClock(NOW),
    nextRunAt: (_now: typeof NOW) => NEXT,
    ...extras,
  };
}

describe('recordAround', () => {
  it('runs the job first even when recordRun rejects', async () => {
    const order: string[] = [];
    const recorder = new FakeRecorder();
    recorder.recordRunImpl = async () => {
      order.push('record');
      throw new Error('mongo down');
    };
    const job = jest.fn(async () => {
      order.push('job');
      return 'ok';
    });
    const onRecorderError = jest.fn();

    await expect(recordAround(job, meta(recorder, { onRecorderError }))).resolves.toBe('ok');

    expect(job).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['job', 'record']);
    expect(onRecorderError).toHaveBeenCalledTimes(1);
  });

  it('resolves the job result when the recorder throws after SUCCESS (does not throw into scheduler)', async () => {
    const recorder = new FakeRecorder();
    recorder.recordRunImpl = async () => {
      throw new Error('catalog write failed');
    };
    const onRecorderError = jest.fn();

    await expect(
      recordAround(async () => 42, meta(recorder, { onRecorderError })),
    ).resolves.toBe(42);

    expect(recorder.recordRunCalls[0]?.lastResult).toBe('SUCCESS');
    expect(recorder.recordRunCalls[0]?.lastError).toBeNull();
    expect(onRecorderError).toHaveBeenCalledTimes(1);
  });

  it('records FAILED then rethrows the original job error', async () => {
    const recorder = new FakeRecorder();
    const jobError = new Error('sweep exploded');

    await expect(recordAround(async () => {
      throw jobError;
    }, meta(recorder))).rejects.toBe(jobError);

    expect(recorder.recordRunCalls).toHaveLength(1);
    expect(recorder.recordRunCalls[0]?.lastResult).toBe('FAILED');
    expect(recorder.recordRunCalls[0]?.lastError).toContain('sweep exploded');
  });

  it('rethrows the original job error when the recorder also throws', async () => {
    const recorder = new FakeRecorder();
    recorder.recordRunImpl = async () => {
      throw new Error('recorder down');
    };
    const jobError = new Error('job failed');
    const onRecorderError = jest.fn();

    await expect(
      recordAround(async () => {
        throw jobError;
      }, meta(recorder, { onRecorderError })),
    ).rejects.toBe(jobError);

    expect(onRecorderError).toHaveBeenCalledTimes(1);
    expect(recorder.recordRunCalls[0]?.lastResult).toBe('FAILED');
  });

  it('records SUCCESS when a resolving job reports per-item failures', async () => {
    const recorder = new FakeRecorder();

    await expect(
      recordAround(async () => ({ failed: 4, processed: 10 }), meta(recorder)),
    ).resolves.toEqual({ failed: 4, processed: 10 });

    expect(recorder.recordRunCalls[0]?.lastResult).toBe('SUCCESS');
    expect(recorder.recordRunCalls[0]?.lastError).toBeNull();
  });

  it('records a tick with no enabled gate (disabled rows still persist)', async () => {
    const recorder = new FakeRecorder();
    const job = jest.fn(async () => 'ran');

    await expect(recordAround(job, meta(recorder))).resolves.toBe('ran');

    expect(job).toHaveBeenCalledTimes(1);
    expect(recorder.recordRunCalls).toHaveLength(1);
    expect(recorder.recordRunCalls[0]?.name).toBe('sla_sweep');
  });

  it('sets next_run_at from the callback, not by parsing cron_expression', async () => {
    const recorder = new FakeRecorder();
    const expectedNext = fromDate(new Date('2026-08-29T05:00:00.000Z'));
    const nextRunAt = jest.fn((_now: typeof NOW) => expectedNext);

    await recordAround(async () => undefined, {
      name: 'wallet_sanctions_rescreen',
      recorder,
      clock: new FixedClock(NOW),
      nextRunAt,
    });

    expect(nextRunAt).toHaveBeenCalledWith(NOW);
    expect(recorder.recordRunCalls[0]?.nextRunAt).toBe(expectedNext);
    expect(recorder.recordRunCalls[0]?.lastRunAt).toBe(NOW);
  });

  it('truncates last_error to about 8 KiB using stack then message', async () => {
    const recorder = new FakeRecorder();
    const huge = 'E'.repeat(LAST_ERROR_LIMIT + 500);
    const jobError = new Error('short message');
    jobError.stack = huge;

    await expect(
      recordAround(async () => {
        throw jobError;
      }, meta(recorder)),
    ).rejects.toBe(jobError);

    expect(recorder.recordRunCalls[0]?.lastError).toHaveLength(LAST_ERROR_LIMIT);
    expect(recorder.recordRunCalls[0]?.lastError?.startsWith('E')).toBe(true);
  });

  it('falls back to message when stack is missing and still truncates', async () => {
    const recorder = new FakeRecorder();
    const hugeMessage = 'M'.repeat(LAST_ERROR_LIMIT + 100);
    const jobError = new Error(hugeMessage);
    jobError.stack = undefined;

    await expect(
      recordAround(async () => {
        throw jobError;
      }, meta(recorder)),
    ).rejects.toBe(jobError);

    expect(recorder.recordRunCalls[0]?.lastError).toHaveLength(LAST_ERROR_LIMIT);
    expect(recorder.recordRunCalls[0]?.lastError?.startsWith('M')).toBe(true);
  });
});

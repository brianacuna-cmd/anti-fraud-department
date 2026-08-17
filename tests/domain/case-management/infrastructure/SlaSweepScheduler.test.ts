import { createSlaSweepScheduler } from '../../../../src/modules/case-management/infrastructure/scheduler/SlaSweepScheduler.js';

/** Gated sleeper — parks the loop on the sleep promise until the test releases it (mirrors CustomerOutgoingEventDispatcher.test.ts). Plain FakeSleeper resolves instantly and must never be used with `start()` — it spins the loop unbounded. */
function buildGatedSleeper() {
  const sleeps: number[] = [];
  const gate: { release?: () => void } = {};
  const sleeper = async (ms: number): Promise<void> => {
    sleeps.push(ms);
    await new Promise<void>((resolve) => {
      gate.release = resolve;
    });
  };
  return { sleeper, sleeps, gate };
}

describe('SlaSweepScheduler', () => {
  it('start() polls sweepSlaTracking on the sleeper interval until stop()', async () => {
    const { sleeper, sleeps, gate } = buildGatedSleeper();
    const sweepSlaTracking = jest.fn(async () => ({ processed: 0, advanced: 0, notified: 0 }));

    const scheduler = createSlaSweepScheduler({ sweepSlaTracking, sleeper });
    const handle = scheduler.start(1000);

    const deadline = Date.now() + 2000;
    while (sleeps.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(sweepSlaTracking).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([1000]);

    handle.stop();
    gate.release?.();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('invokes onError and keeps looping when sweepSlaTracking rejects', async () => {
    const { sleeper, sleeps, gate } = buildGatedSleeper();
    const onError = jest.fn();
    const sweepSlaTracking = jest.fn(async () => {
      throw new Error('boom');
    });

    const scheduler = createSlaSweepScheduler({ sweepSlaTracking, sleeper, onError });
    const handle = scheduler.start(500);

    const deadline = Date.now() + 2000;
    while (sleeps.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(onError).toHaveBeenCalledWith(new Error('boom'));
    expect(sleeps).toEqual([500]);

    handle.stop();
    gate.release?.();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('stop() halts the loop before a second tick runs', async () => {
    const sleepGate: { release?: () => void } = {};
    const sleeps: number[] = [];
    const gatedSleeper = async (ms: number): Promise<void> => {
      sleeps.push(ms);
      await new Promise<void>((resolve) => {
        sleepGate.release = resolve;
      });
    };
    const sweepSlaTracking = jest.fn(async () => ({ processed: 0, advanced: 0, notified: 0 }));

    const scheduler = createSlaSweepScheduler({ sweepSlaTracking, sleeper: gatedSleeper });
    const handle = scheduler.start(1000);

    const deadline = Date.now() + 2000;
    while (sleeps.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(sweepSlaTracking).toHaveBeenCalledTimes(1);

    handle.stop();
    sleepGate.release?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(sweepSlaTracking).toHaveBeenCalledTimes(1);
  });
});

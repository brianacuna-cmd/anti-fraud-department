import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import {
  createDailyMetricsAggregatorScheduler,
} from '../../../../src/modules/case-management/infrastructure/scheduler/DailyMetricsAggregatorScheduler.js';
import { msUntilNextMidnightBogota } from '../../../../src/modules/screening/application/WalletSanctionsRescreenScheduler.js';

/** Parks the loop on the sleep promise until the test releases it. */
function buildGatedSleeper() {
  const sleeps: number[] = [];
  const gate: { release?: () => void } = {};
  const sleeper = async (ms: number) => {
    sleeps.push(ms);
    await new Promise<void>((r) => { gate.release = r; });
  };
  return { sleeper, sleeps, gate };
}

async function waitFor(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setImmediate(r));
}

// 09:00 Bogotá → next midnight = 2026-08-27T05:00:00Z
const AFTERNOON_UTC = new Date('2026-08-26T14:00:00.000Z');

describe('DailyMetricsAggregatorScheduler', () => {
  it('run(): two concurrent calls share one promise; runAggregate called once', async () => {
    let resolve!: () => void;
    const runAggregate = jest.fn(() => new Promise<void>((r) => { resolve = r; }));
    const s = createDailyMetricsAggregatorScheduler({ runAggregate });
    const p1 = s.run();
    const p2 = s.run();
    expect(p1).toBe(p2);
    resolve();
    await p1;
    expect(runAggregate).toHaveBeenCalledTimes(1);
  });

  it('start(): sleeps the computed midnight delay before first run', async () => {
    const { sleeper, sleeps, gate } = buildGatedSleeper();
    const clock = new FixedClock(fromDate(AFTERNOON_UTC));
    const runAggregate = jest.fn(async () => {});
    const s = createDailyMetricsAggregatorScheduler({ runAggregate, clock, sleeper });
    s.start();
    await waitFor(() => sleeps.length > 0);
    expect(sleeps[0]).toBe(msUntilNextMidnightBogota(AFTERNOON_UTC));
    s.stop();
    gate.release?.();
    await new Promise((r) => setImmediate(r));
  });

  it('stop(): prevents run from executing after gate releases', async () => {
    const { sleeper, sleeps, gate } = buildGatedSleeper();
    const clock = new FixedClock(fromDate(AFTERNOON_UTC));
    const runAggregate = jest.fn(async () => {});
    const s = createDailyMetricsAggregatorScheduler({ runAggregate, clock, sleeper });
    s.start();
    await waitFor(() => sleeps.length > 0);
    s.stop();
    gate.release?.();
    await new Promise((r) => setImmediate(r));
    expect(runAggregate).not.toHaveBeenCalled();
  });

  it('onError: captures error and loop continues to next tick', async () => {
    const { sleeper, sleeps, gate } = buildGatedSleeper();
    const clock = new FixedClock(fromDate(AFTERNOON_UTC));
    const onError = jest.fn();
    const runAggregate = jest.fn(async () => { throw new Error('boom'); });
    const s = createDailyMetricsAggregatorScheduler({ runAggregate, clock, sleeper, onError });
    s.start();
    await waitFor(() => sleeps.length >= 1);
    gate.release?.();
    await waitFor(() => sleeps.length >= 2);
    expect(onError).toHaveBeenCalledWith(new Error('boom'));
    s.stop();
    gate.release?.();
    await new Promise((r) => setImmediate(r));
  });

  it('onError: a throwing sleeper is caught and the loop survives (does not escape as an unhandled rejection)', async () => {
    let attempt = 0;
    const gate: { release?: () => void } = {};
    // First tick's sleeper throws (models a throwing clock/sleeper before run());
    // subsequent ticks park so the loop can be observed still alive and stopped.
    const sleeper = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('sleeper-boom');
      await new Promise<void>((r) => { gate.release = r; });
    };
    const clock = new FixedClock(fromDate(AFTERNOON_UTC));
    const onError = jest.fn();
    const runAggregate = jest.fn(async () => {});
    const s = createDailyMetricsAggregatorScheduler({ runAggregate, clock, sleeper, onError });
    s.start();
    await waitFor(() => attempt >= 2);
    expect(onError).toHaveBeenCalledWith(new Error('sleeper-boom'));
    expect(attempt).toBeGreaterThanOrEqual(2);
    s.stop();
    gate.release?.();
    await new Promise((r) => setImmediate(r));
  });
});

import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import {
  createDailyBogotaScheduler,
  msUntilNextBogotaTime,
} from '../../../../src/modules/screening/application/DailyBogotaScheduler.js';

const HOUR = 60 * 60 * 1000;
// Bogota is UTC-5 all year round (no DST).
const at = (iso: string) => new Date(iso);

describe('msUntilNextBogotaTime', () => {
  it('waits until the target hour later the same day', () => {
    expect(msUntilNextBogotaTime(at('2026-01-01T03:00:00.000Z'), 23)).toBe(1 * HOUR); // 22:00 -> 23:00
  });

  it('is zero at exactly the target time', () => {
    expect(msUntilNextBogotaTime(at('2026-01-01T04:00:00.000Z'), 23)).toBe(0); // 23:00
  });

  it('rolls over to the next day once the target has passed', () => {
    expect(msUntilNextBogotaTime(at('2026-01-01T04:30:00.000Z'), 23)).toBe(23.5 * HOUR); // 23:30 -> 23:00
  });

  it('crosses midnight for an early-morning target', () => {
    expect(msUntilNextBogotaTime(at('2026-01-01T03:00:00.000Z'), 1)).toBe(3 * HOUR); // 22:00 -> 01:00
  });

  it('honours minutes', () => {
    expect(msUntilNextBogotaTime(at('2026-01-01T05:00:00.000Z'), 1, 30)).toBe(1.5 * HOUR); // 00:00 -> 01:30
  });
});

describe('createDailyBogotaScheduler', () => {
  it('runs once at a time: a second trigger while running joins the first', async () => {
    let release: () => void = () => undefined;
    const run = jest.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const scheduler = createDailyBogotaScheduler({ run, hour: 23, label: 'test' });

    const first = scheduler.run();
    const second = scheduler.run();
    release();
    await Promise.all([first, second]);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports a failed run instead of rejecting, so the loop survives it', async () => {
    const boom = new Error('feed unreachable');
    const onError = jest.fn();
    const scheduler = createDailyBogotaScheduler({
      run: async () => { throw boom; },
      hour: 23,
      label: 'test',
      onError,
    });

    await expect(scheduler.run()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('sleeps until the configured time before the first run', async () => {
    const clock = new FixedClock(fromDate(at('2026-01-01T03:00:00.000Z')));
    const run = jest.fn(async () => undefined);
    const sleeper = jest
      .fn<Promise<void>, [number]>()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(() => new Promise<void>(() => undefined));
    const scheduler = createDailyBogotaScheduler({ run, hour: 23, label: 'test', clock, sleeper });

    scheduler.start();
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    scheduler.stop();

    expect(sleeper).toHaveBeenNthCalledWith(1, 1 * HOUR);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

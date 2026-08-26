import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import {
  createWalletSanctionsRescreenScheduler,
  msUntilNextMidnightBogota,
} from '../../../../src/modules/screening/application/WalletSanctionsRescreenScheduler.js';

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

describe('WalletSanctionsRescreenScheduler', () => {
  it('run(): two concurrent calls share one promise; runRescreen called once', async () => {
    let resolve!: () => void;
    const runRescreen = jest.fn(() => new Promise<void>((r) => { resolve = r; }));
    const s = createWalletSanctionsRescreenScheduler({ runRescreen });
    const p1 = s.run();
    const p2 = s.run();
    expect(p1).toBe(p2);
    resolve();
    await p1;
    expect(runRescreen).toHaveBeenCalledTimes(1);
  });

  it('start(): sleeps the computed midnight delay before first run', async () => {
    const { sleeper, sleeps, gate } = buildGatedSleeper();
    const clock = new FixedClock(fromDate(AFTERNOON_UTC));
    const runRescreen = jest.fn(async () => {});
    const s = createWalletSanctionsRescreenScheduler({ runRescreen, clock, sleeper });
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
    const runRescreen = jest.fn(async () => {});
    const s = createWalletSanctionsRescreenScheduler({ runRescreen, clock, sleeper });
    s.start();
    await waitFor(() => sleeps.length > 0);
    s.stop();
    gate.release?.();
    await new Promise((r) => setImmediate(r));
    expect(runRescreen).not.toHaveBeenCalled();
  });

  it('onError: captures error and loop continues to next tick', async () => {
    const { sleeper, sleeps, gate } = buildGatedSleeper();
    const clock = new FixedClock(fromDate(AFTERNOON_UTC));
    const onError = jest.fn();
    const runRescreen = jest.fn(async () => { throw new Error('boom'); });
    const s = createWalletSanctionsRescreenScheduler({ runRescreen, clock, sleeper, onError });
    s.start();
    await waitFor(() => sleeps.length >= 1);
    gate.release?.();
    await waitFor(() => sleeps.length >= 2);
    expect(onError).toHaveBeenCalledWith(new Error('boom'));
    s.stop();
    gate.release?.();
    await new Promise((r) => setImmediate(r));
  });

  describe('msUntilNextMidnightBogota()', () => {
    it('returns positive ms for mid-afternoon Bogotá', () => {
      const expected = new Date('2026-08-27T05:00:00.000Z').getTime() - AFTERNOON_UTC.getTime();
      expect(msUntilNextMidnightBogota(AFTERNOON_UTC)).toBe(expected);
    });
    it('returns 0 at exactly midnight Bogotá (05:00 UTC)', () => {
      expect(msUntilNextMidnightBogota(new Date('2026-08-26T05:00:00.000Z'))).toBe(0);
    });
  });
});

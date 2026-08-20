import { oid } from '../../../../support/oid.js';
import { CaseSlaTracking } from '../../../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import { createCaseSlaTrackingId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { createCaseId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T01:00:00.000Z'));

function buildTracking(
  overrides: Partial<Parameters<typeof CaseSlaTracking.create>[0]> = {},
): CaseSlaTracking {
  return CaseSlaTracking.create({
    id: createCaseSlaTrackingId(oid('tracking-1')),
    caseId: createCaseId(oid('case-1')),
    dueDate: NOW,
    now: NOW,
    ...overrides,
  });
}

describe('CaseSlaTracking.create', () => {
  it('creates a tracking row with Status ON_TRACK and no NotifiedStatuses', () => {
    const tracking = buildTracking();

    expect(tracking.status).toBe('ON_TRACK');
    expect(tracking.hasNotified('ON_TRACK')).toBe(false);
    expect(tracking.hasNotified('WARNING')).toBe(false);
    expect(tracking.hasNotified('BREACHED')).toBe(false);
    expect(tracking.dueDate).toBe(NOW);
    expect(tracking.caseId).toBe(oid('case-1'));
  });
});

describe('CaseSlaTracking.rehydrate', () => {
  it('reconstructs from persisted props without validation', () => {
    const tracking = buildTracking();
    const rehydrated = CaseSlaTracking.rehydrate(tracking.toProps());

    expect(rehydrated.id).toBe(tracking.id);
    expect(rehydrated.status).toBe(tracking.status);
  });
});

describe('CaseSlaTracking.advanceTo (forward-only sweep)', () => {
  it('advances ON_TRACK -> WARNING', () => {
    const tracking = buildTracking().advanceTo('WARNING', LATER);

    expect(tracking.status).toBe('WARNING');
    expect(tracking.updatedAt).toBe(LATER);
  });

  it('advances WARNING -> BREACHED', () => {
    const tracking = buildTracking().advanceTo('WARNING', NOW).advanceTo('BREACHED', LATER);

    expect(tracking.status).toBe('BREACHED');
  });

  it('rejects a backward transition (BREACHED -> WARNING)', () => {
    const tracking = buildTracking().advanceTo('WARNING', NOW).advanceTo('BREACHED', NOW);

    expect(() => tracking.advanceTo('WARNING', LATER)).toThrow('cannot transition');
  });

  it('rejects a skip transition (ON_TRACK -> BREACHED)', () => {
    const tracking = buildTracking();

    expect(() => tracking.advanceTo('BREACHED', LATER)).toThrow('cannot transition');
  });
});

describe('CaseSlaTracking.markNotified (PR1: per-status re-notify)', () => {
  it('marks only the given status notified; other statuses remain un-notified', () => {
    const tracking = buildTracking().markNotified('ON_TRACK', LATER);

    expect(tracking.hasNotified('ON_TRACK')).toBe(true);
    expect(tracking.hasNotified('WARNING')).toBe(false);
    expect(tracking.updatedAt).toBe(LATER);
  });

  it('accumulates notified statuses across hops: WARNING then BREACHED both marked independently', () => {
    const tracking = buildTracking()
      .advanceTo('WARNING', NOW)
      .markNotified('WARNING', NOW)
      .advanceTo('BREACHED', LATER)
      .markNotified('BREACHED', LATER);

    expect(tracking.hasNotified('WARNING')).toBe(true);
    expect(tracking.hasNotified('BREACHED')).toBe(true);
  });
});

describe('CaseSlaTracking.reset (T6)', () => {
  it('resets Status to ON_TRACK, clears NotifiedStatuses, and recomputes DueDate', () => {
    const tracking = buildTracking()
      .advanceTo('WARNING', NOW)
      .markNotified('WARNING', NOW)
      .reset(LATER, LATER);

    expect(tracking.status).toBe('ON_TRACK');
    expect(tracking.hasNotified('WARNING')).toBe(false);
    expect(tracking.hasNotified('ON_TRACK')).toBe(false);
    expect(tracking.dueDate).toBe(LATER);
  });
});

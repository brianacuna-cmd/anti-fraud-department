import { oid } from '../../../../support/oid.js';
import { AmlAlert } from '../../../../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { generateAmlAlertId } from '../../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildMatchedEntry() {
  return createScreeningMatch({
    entryId: createWatchlistEntryId(oid('entry-1')),
    watchlistId: createWatchlistId(oid('watchlist-1')),
    nombre: 'John Smith',
    documento: '123456789',
    nivelRiesgo: 'HIGH',
    matchField: 'NAME',
    algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
  });
}

function buildAlert(): AmlAlert {
  return AmlAlert.create({
    id: generateAmlAlertId(),
    organizationId: oid('org-1'),
    customerId: oid('customer-1'),
    entidadSospechosa: 'John Smith',
    confianza: createMatchScore(82),
    fuenteDeteccion: 'index',
    matchedEntry: buildMatchedEntry(),
    now: NOW,
  });
}

describe('AmlAlert.create', () => {
  it('starts a new alert OPEN, WATCHLIST_MATCH, with no linked case', () => {
    const alert = buildAlert();

    expect(alert.estado).toBe('OPEN');
    expect(alert.tipoAlerta).toBe('WATCHLIST_MATCH');
    expect(alert.caseId).toBeNull();
    expect(alert.createdAt).toBe(NOW);
    expect(alert.updatedAt).toBe(NOW);
    expect(alert.confianza).toBe(82);
    expect(alert.matchedEntry.matchField).toBe('NAME');
  });

  it('rejects an empty organizationId', () => {
    expect(() =>
      AmlAlert.create({
        id: generateAmlAlertId(),
        organizationId: '   ',
        customerId: oid('customer-1'),
        entidadSospechosa: 'John Smith',
        confianza: createMatchScore(82),
        fuenteDeteccion: 'index',
        matchedEntry: buildMatchedEntry(),
        now: NOW,
      }),
    ).toThrow(ScreeningError);
  });
});

describe('AmlAlert.rehydrate', () => {
  it('reconstructs an alert from stored props without re-validating business rules', () => {
    const alert = AmlAlert.rehydrate({
      id: generateAmlAlertId(),
      organizationId: oid('org-1'),
      customerId: oid('customer-1'),
      tipoAlerta: 'WATCHLIST_MATCH',
      entidadSospechosa: 'John Smith',
      confianza: createMatchScore(95),
      fuenteDeteccion: 'index',
      estado: 'INVESTIGATING',
      matchedEntry: buildMatchedEntry(),
      caseId: oid('case-1'),
      createdAt: NOW,
      updatedAt: LATER,
    });

    expect(alert.estado).toBe('INVESTIGATING');
    expect(alert.caseId).toBe(oid('case-1'));
    expect(alert.updatedAt).toBe(LATER);
  });
});

describe('AmlAlert#transitionTo', () => {
  it('moves OPEN -> INVESTIGATING on a valid forward transition', () => {
    const alert = buildAlert();

    const transitioned = alert.transitionTo('INVESTIGATING', LATER);

    expect(transitioned).not.toBe(alert);
    expect(transitioned.estado).toBe('INVESTIGATING');
    expect(transitioned.updatedAt).toBe(LATER);
    expect(alert.estado).toBe('OPEN');
  });

  it('allows INVESTIGATING -> RESOLVED', () => {
    const alert = buildAlert().transitionTo('INVESTIGATING', NOW);

    const resolved = alert.transitionTo('RESOLVED', LATER);

    expect(resolved.estado).toBe('RESOLVED');
  });

  it('allows INVESTIGATING -> FALSE_POSITIVE', () => {
    const alert = buildAlert().transitionTo('INVESTIGATING', NOW);

    const falsePositive = alert.transitionTo('FALSE_POSITIVE', LATER);

    expect(falsePositive.estado).toBe('FALSE_POSITIVE');
  });

  it('rejects OPEN -> RESOLVED (must pass through INVESTIGATING) and leaves original untouched', () => {
    const alert = buildAlert();

    expect(() => alert.transitionTo('RESOLVED', LATER)).toThrow(ScreeningError);
    expect(alert.estado).toBe('OPEN');
  });

  it('rejects transitioning out of a terminal RESOLVED state', () => {
    const resolved = buildAlert().transitionTo('INVESTIGATING', NOW).transitionTo('RESOLVED', NOW);

    expect(() => resolved.transitionTo('OPEN', LATER)).toThrow(ScreeningError);
  });
});

describe('AmlAlert#linkCase', () => {
  it('links a caseId without affecting the alert lifecycle status', () => {
    const alert = buildAlert();

    const linked = alert.linkCase(oid('case-1'), LATER);

    expect(linked).not.toBe(alert);
    expect(linked.caseId).toBe(oid('case-1'));
    expect(linked.estado).toBe('OPEN');
    expect(alert.caseId).toBeNull();
  });
});

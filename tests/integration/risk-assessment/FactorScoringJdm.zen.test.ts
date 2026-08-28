import { ZenRiskScoringEngine } from '../../../src/modules/risk-assessment/infrastructure/adapters/outbound/zen/ZenRiskScoringEngine.js';
import {
  buildFactorScoringJdm,
  type ScoringFactor,
} from '../../../src/modules/risk-assessment/domain/services/factorScoringJdm.js';

/**
 * El constructor guiado contra el motor de verdad.
 *
 * Los tests de dominio comprueban la FORMA del grafo; este comprueba que ZEN
 * lo entiende y devuelve lo que `CalculateRiskScore` espera. Es la única
 * prueba que falla si `@gorules/zen-engine` cambia el lenguaje de las celdas,
 * y sin ella un cambio de versión rompería la puntuación en producción con
 * todos los tests en verde.
 *
 * Usa las señales que los mapeadores mandan DE VERDAD (`stripeRiskScore`,
 * `watchlistRiskLevel`), no campos inventados.
 */
const FACTORS: readonly ScoringFactor[] = [
  { field: 'amountCents', operator: 'GT', value: 500_000, points: 30, reason: 'Importe alto' },
  { field: 'riskSignals.stripeRiskScore', operator: 'GT', value: 75, points: 40, reason: 'Radar alto' },
  { field: 'riskSignals.stripeRiskLevel', operator: 'EQ', value: 'highest', points: 20, reason: 'Radar: highest' },
  { field: 'riskSignals.watchlistRiskLevel', operator: 'EQ', value: 'CRITICAL', points: 50, reason: 'Coincidencia en lista' },
];

describe('buildFactorScoringJdm evaluated by the real ZenRiskScoringEngine', () => {
  let engine: ZenRiskScoringEngine;

  beforeAll(() => {
    engine = new ZenRiskScoringEngine();
  });

  afterAll(() => {
    engine.dispose();
  });

  it('adds up every factor the event triggers', async () => {
    const result = await engine.evaluate(buildFactorScoringJdm(FACTORS), {
      provider: 'stripe',
      amountCents: 750_000,
      currency: 'USD',
      riskSignals: { stripeRiskScore: 82, stripeRiskLevel: 'highest' },
    });

    expect(result.riskScore).toBe(90);
    expect(result.hits.map((h) => (h as { reason: string }).reason)).toEqual([
      'Importe alto',
      'Radar alto',
      'Radar: highest',
    ]);
  });

  /*
   * El evento de Bridge es el que mas rompe una regla mal escrita: llega casi
   * sin senales. Tiene que dar 0 y no reventar.
   */
  it('returns 0 with no hits for an event that carries almost no signals', async () => {
    const result = await engine.evaluate(buildFactorScoringJdm(FACTORS), {
      provider: 'bridge',
      amountCents: 1_200,
      currency: 'USD',
      riskSignals: { status: 'payment_processed' },
    });

    expect(result.riskScore).toBe(0);
    expect(result.hits).toEqual([]);
  });

  /*
   * `RiskScore` rechaza fuera de [0,100], asi que el tope tiene que caer
   * aqui: sin el, esta combinacion haria fallar la evaluacion entera en vez
   * de dar el maximo.
   */
  it('caps a runaway total at 100 instead of failing the evaluation', async () => {
    const result = await engine.evaluate(buildFactorScoringJdm(FACTORS), {
      provider: 'bridge',
      amountCents: 900_000,
      currency: 'USD',
      riskSignals: { watchlistRiskLevel: 'CRITICAL', stripeRiskScore: 90, stripeRiskLevel: 'highest' },
    });

    expect(result.riskScore).toBe(100);
  });

  it('floors a negative total at 0', async () => {
    const result = await engine.evaluate(
      buildFactorScoringJdm([
        { field: 'amountCents', operator: 'GT', value: 0, points: 10, reason: 'Suma' },
        { field: 'provider', operator: 'EQ', value: 'stripe', points: -50, reason: 'Resta' },
      ]),
      { provider: 'stripe', amountCents: 1, currency: 'USD', riskSignals: {} },
    );

    expect(result.riskScore).toBe(0);
  });

  it('handles every operator against the engine', async () => {
    const result = await engine.evaluate(
      buildFactorScoringJdm([
        { field: 'amountCents', operator: 'BETWEEN', value: [100, 200], points: 5, reason: 'Tramo' },
        { field: 'rail', operator: 'IN', value: ['card', 'ach'], points: 5, reason: 'Rail' },
        { field: 'currency', operator: 'CONTAINS', value: 'US', points: 5, reason: 'USD' },
        { field: 'provider', operator: 'NEQ', value: 'stripe', points: 5, reason: 'No stripe' },
        { field: 'providerEventType', operator: 'LTE', value: 0, points: 5, reason: 'Nunca' },
      ]),
      {
        provider: 'bridge',
        providerEventType: 'transfer.created',
        rail: 'card',
        amountCents: 150,
        currency: 'USD',
        riskSignals: {},
      },
    );

    expect(result.riskScore).toBe(20);
    expect(result.hits.map((h) => (h as { reason: string }).reason)).toEqual([
      'Tramo',
      'Rail',
      'USD',
      'No stripe',
    ]);
  });

  /* Una comilla en el motivo no puede convertirse en sintaxis. */
  it('escapes a quote in the reason instead of splicing it into the cell', async () => {
    const result = await engine.evaluate(
      buildFactorScoringJdm([
        { field: 'provider', operator: 'EQ', value: 'stripe', points: 10, reason: 'dice "alto"' },
      ]),
      { provider: 'stripe', amountCents: 1, currency: 'USD', riskSignals: {} },
    );

    expect(result.riskScore).toBe(10);
    expect((result.hits[0] as { reason: string }).reason).toBe('dice "alto"');
  });
});

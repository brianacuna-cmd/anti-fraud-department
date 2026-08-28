import {
  buildFactorScoringJdm,
  isScorableField,
  type ScoringFactor,
} from '../../../../src/modules/risk-assessment/domain/services/factorScoringJdm.js';
import { RiskAssessmentError } from '../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';
import { tableOf } from '../../../support/jdm.js';

function cellOf(factor: ScoringFactor): string {
  return tableOf(buildFactorScoringJdm([factor])).rules[0]!.i1!;
}

const BASE: ScoringFactor = {
  field: 'amountCents',
  operator: 'GT',
  value: 500_000,
  points: 40,
  reason: 'Importe alto',
};

describe('buildFactorScoringJdm', () => {
  it('collects every matching factor instead of stopping at the first', () => {
    expect(tableOf(buildFactorScoringJdm([BASE])).hitPolicy).toBe('collect');
  });

  /*
   * Una columna por campo DISTINTO, no por factor: dos factores sobre
   * `amountCents` comparten columna, y cada fila deja en blanco las que no
   * mira. En blanco significa "no miro este campo", no "vale vacio".
   */
  it('gives each distinct field one column and blanks the rest per row', () => {
    const table = tableOf(
      buildFactorScoringJdm([
        BASE,
        { ...BASE, value: 100_000, points: 15, reason: 'Importe medio' },
        { field: 'provider', operator: 'EQ', value: 'stripe', points: 10, reason: 'Stripe' },
      ]),
    );

    expect(table.inputs.map((i) => i.field)).toEqual(['amountCents', 'provider']);
    expect(table.rules).toEqual([
      { _id: 'r1', i1: '> 500000', i2: '', o1: '40', o2: '"Importe alto"' },
      { _id: 'r2', i1: '> 100000', i2: '', o1: '15', o2: '"Importe medio"' },
      { _id: 'r3', i1: '', i2: '"stripe"', o1: '10', o2: '"Stripe"' },
    ]);
  });

  it('renders every operator in the ZEN cell language', () => {
    expect(cellOf({ ...BASE, operator: 'GT', value: 10 })).toBe('> 10');
    expect(cellOf({ ...BASE, operator: 'GTE', value: 10 })).toBe('>= 10');
    expect(cellOf({ ...BASE, operator: 'LT', value: 10 })).toBe('< 10');
    expect(cellOf({ ...BASE, operator: 'LTE', value: 10 })).toBe('<= 10');
    expect(cellOf({ ...BASE, operator: 'EQ', value: 10 })).toBe('10');
    expect(cellOf({ ...BASE, field: 'provider', operator: 'EQ', value: 'stripe' })).toBe('"stripe"');
    expect(cellOf({ ...BASE, field: 'provider', operator: 'NEQ', value: 'stripe' })).toBe('!= "stripe"');
    expect(cellOf({ ...BASE, field: 'currency', operator: 'CONTAINS', value: 'USD' })).toBe('contains($, "USD")');
    expect(cellOf({ ...BASE, field: 'rail', operator: 'IN', value: ['card', 'ach'] })).toBe('"card","ach"');
    expect(cellOf({ ...BASE, operator: 'BETWEEN', value: [100, 200] })).toBe('[100..200]');
  });

  /*
   * El motor NO tiene escape con barra invertida: `"dice \"alto\""` no da
   * error, descarta la fila en silencio. Por eso la comilla que envuelve se
   * elige segun lo que lleva el texto.
   */
  describe('quoting, which the engine cannot escape', () => {
    it('wraps in single quotes when the text carries a double quote', () => {
      const table = tableOf(buildFactorScoringJdm([{ ...BASE, reason: 'dice "alto"' }]));
      expect(table.rules[0]!.o2).toBe("'dice \"alto\"'");
    });

    it('wraps in double quotes when the text carries an apostrophe', () => {
      const table = tableOf(buildFactorScoringJdm([{ ...BASE, reason: "bank's team" }]));
      expect(table.rules[0]!.o2).toBe('"bank\'s team"');
    });

    /* Con las dos no hay forma de expresarlo: mejor negarse que ignorar la fila. */
    it('refuses a value carrying both quote characters', () => {
      expect(() => buildFactorScoringJdm([{ ...BASE, reason: `a"b'c` }])).toThrow(RiskAssessmentError);
    });
  });

  it('keeps negative points, which is how a factor lowers risk', () => {
    const table = tableOf(buildFactorScoringJdm([{ ...BASE, points: -20, reason: 'Cliente verificado' }]));
    expect(table.rules[0]!.o1).toBe('-20');
  });

  describe('rejects what would compile into a rule that lies', () => {
    it('an empty factor list', () => {
      expect(() => buildFactorScoringJdm([])).toThrow(RiskAssessmentError);
    });

    /*
     * `rawPayload` es justo el campo que `CalculateRiskScore` borra del
     * contexto antes de evaluar: una regla que lo mirara no fallaria, casaria
     * siempre en falso y nadie sabria por que no puntua.
     */
    it('a field outside the scorable allowlist', () => {
      expect(() => buildFactorScoringJdm([{ ...BASE, field: 'rawPayload.secret' }])).toThrow(RiskAssessmentError);
      expect(isScorableField('rawPayload.secret')).toBe(false);
      expect(isScorableField('riskSignals.stripeRiskScore')).toBe(true);
      expect(isScorableField('riskSignals.a.b')).toBe(false);
    });

    it('points outside [-100, 100] or not whole', () => {
      expect(() => buildFactorScoringJdm([{ ...BASE, points: 101 }])).toThrow(RiskAssessmentError);
      expect(() => buildFactorScoringJdm([{ ...BASE, points: 1.5 }])).toThrow(RiskAssessmentError);
    });

    it('a factor with no reason, which would leave an unexplained hit in the case', () => {
      expect(() => buildFactorScoringJdm([{ ...BASE, reason: '   ' }])).toThrow(RiskAssessmentError);
    });

    it('a value whose type the operator cannot use', () => {
      expect(() => buildFactorScoringJdm([{ ...BASE, operator: 'GT', value: 'mucho' }])).toThrow(RiskAssessmentError);
      expect(() => buildFactorScoringJdm([{ ...BASE, operator: 'IN', value: 'ach' }])).toThrow(RiskAssessmentError);
      expect(() => buildFactorScoringJdm([{ ...BASE, operator: 'BETWEEN', value: [200, 100] }])).toThrow(RiskAssessmentError);
      expect(() => buildFactorScoringJdm([{ ...BASE, operator: 'EQ', value: [1, 2] }])).toThrow(RiskAssessmentError);
    });
  });
});

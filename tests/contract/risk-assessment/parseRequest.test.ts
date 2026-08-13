import { z } from 'zod';
import { parseRequest } from '../../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/parseRequest.js';
import { RiskAssessmentError } from '../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';

const schema = z.object({ provider: z.string().min(1) });

describe('parseRequest', () => {
  it('returns the parsed value when the payload matches the schema', () => {
    const result = parseRequest(schema, { provider: 'stripe' });

    expect(result).toEqual({ provider: 'stripe' });
  });

  it('throws an INVARIANT_VIOLATION RiskAssessmentError when the payload fails validation', () => {
    expect.assertions(2);
    try {
      parseRequest(schema, { provider: '' });
    } catch (error) {
      expect(error).toBeInstanceOf(RiskAssessmentError);
      expect((error as InstanceType<typeof RiskAssessmentError>).code).toBe('INVARIANT_VIOLATION');
    }
  });
});

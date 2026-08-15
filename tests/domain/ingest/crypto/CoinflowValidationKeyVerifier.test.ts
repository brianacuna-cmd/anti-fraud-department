import { CoinflowValidationKeyVerifier } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/crypto/CoinflowValidationKeyVerifier.js';

const BODY = Buffer.from(
  '{"eventType":"Card Payment Suspected Fraud","data":{"id":"pay_1"}}',
  'utf8',
);
const VALIDATION_KEY = 'cf_validation_key_live_abc123';

describe('CoinflowValidationKeyVerifier', () => {
  const verifier = new CoinflowValidationKeyVerifier();

  it('accepts Authorization equal to the Validation Key using constant-time compare', () => {
    expect(
      verifier.verify(BODY, { Authorization: VALIDATION_KEY }, VALIDATION_KEY),
    ).toBe(true);
  });

  it('accepts a lowercase authorization header (Express)', () => {
    expect(
      verifier.verify(BODY, { authorization: VALIDATION_KEY }, VALIDATION_KEY),
    ).toBe(true);
  });

  it('fails closed when Authorization is missing', () => {
    expect(verifier.verify(BODY, {}, VALIDATION_KEY)).toBe(false);
  });

  it('fails closed when Authorization does not match the Validation Key', () => {
    expect(
      verifier.verify(BODY, { Authorization: 'wrong-key' }, VALIDATION_KEY),
    ).toBe(false);
  });

  it('does not treat Authorization as a session Bearer token', () => {
    const sessionBearer = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig';

    expect(verifier.verify(BODY, { Authorization: sessionBearer }, VALIDATION_KEY)).toBe(false);
    expect(
      verifier.verify(BODY, { Authorization: `Bearer ${VALIDATION_KEY}` }, VALIDATION_KEY),
    ).toBe(false);
  });

  it('fails closed when Authorization is empty', () => {
    expect(verifier.verify(BODY, { Authorization: '' }, VALIDATION_KEY)).toBe(false);
  });
});

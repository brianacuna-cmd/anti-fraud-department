import { parseTrustProxy } from '../../../src/shared/http/parseTrustProxy.js';

describe('parseTrustProxy', () => {
  it('defaults to false when undefined (fail-safe)', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
  });

  it('defaults to false for an empty string', () => {
    expect(parseTrustProxy('')).toBe(false);
  });

  it('parses "true" as boolean true', () => {
    expect(parseTrustProxy('true')).toBe(true);
  });

  it('parses "false" as boolean false', () => {
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('parses a pure integer string as a hop count number', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('passes through any other string verbatim (e.g. loopback, CIDR)', () => {
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
  });
});

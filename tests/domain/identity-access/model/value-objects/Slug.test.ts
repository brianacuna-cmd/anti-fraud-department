import { createSlug } from '../../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';

describe('createSlug', () => {
  it('accepts a lowercase alphanumeric-with-hyphens slug and returns it unchanged', () => {
    const slug = createSlug('acme-corp');

    expect(slug).toBe('acme-corp');
  });

  it('accepts a single-word slug with no hyphens', () => {
    const slug = createSlug('acme');

    expect(slug).toBe('acme');
  });

  it('rejects an empty string as an invariant violation', () => {
    expect(() => createSlug('')).toThrow(/Slug/);
  });

  it('rejects uppercase characters as an invariant violation', () => {
    expect(() => createSlug('Acme-Corp')).toThrow(/Slug/);
  });

  it('rejects a leading hyphen as an invariant violation', () => {
    expect(() => createSlug('-acme')).toThrow(/Slug/);
  });

  it('rejects spaces as an invariant violation', () => {
    expect(() => createSlug('acme corp')).toThrow(/Slug/);
  });
});

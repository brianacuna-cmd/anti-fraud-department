import { buildCursorPage, parsePaginationParams } from '../../../src/shared/http/pagination.js';

describe('parsePaginationParams', () => {
  it('defaults limit to 25 when no limit is given', () => {
    expect(parsePaginationParams({})).toEqual({ limit: 25 });
  });

  it('caps limit at 100 when a larger value is requested', () => {
    expect(parsePaginationParams({ limit: '500' })).toEqual({ limit: 100 });
  });

  it('uses the requested limit when within range', () => {
    expect(parsePaginationParams({ limit: '10' })).toEqual({ limit: 10 });
  });

  it('falls back to the default for a non-numeric or non-positive limit', () => {
    expect(parsePaginationParams({ limit: 'not-a-number' })).toEqual({ limit: 25 });
    expect(parsePaginationParams({ limit: '-5' })).toEqual({ limit: 25 });
  });

  it('passes through a string cursor when present', () => {
    expect(parsePaginationParams({ cursor: 'abc123' })).toEqual({ limit: 25, cursor: 'abc123' });
  });
});

describe('buildCursorPage', () => {
  const items = [
    { cursorId: '1', name: 'a' },
    { cursorId: '2', name: 'b' },
    { cursorId: '3', name: 'c' },
  ];

  it('returns all items and a null nextCursor when there are no more results than the limit', () => {
    const page = buildCursorPage(items, 3);

    expect(page).toEqual({ items, nextCursor: null });
  });

  it('returns only `limit` items and a nextCursor when more results exist than the page size', () => {
    // Repository fetches limit+1 to detect "has more" without a separate count query.
    const page = buildCursorPage(items, 2);

    expect(page.items).toEqual([items[0], items[1]]);
    expect(page.nextCursor).toBe('2');
  });
});

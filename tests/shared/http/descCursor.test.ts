import {
  encodeDescCursor,
  decodeDescCursor,
  buildDescCursorPage,
} from '../../../src/shared/http/pagination.js';

describe('encodeDescCursor / decodeDescCursor', () => {
  it('round-trips a valid composite key', () => {
    const ms = 1_700_000_000_000;
    const id = 'aabbccddeeff00112233445566';

    const cursor = encodeDescCursor(ms, id);
    const decoded = decodeDescCursor(cursor);

    expect(decoded).toEqual({ exhaustedAtMs: ms, id });
  });

  it('returns null for a plain non-base64 string', () => {
    expect(decodeDescCursor('not-valid-base64!!!')).toBeNull();
  });

  it('returns null when the decoded payload has no colon separator', () => {
    const noColon = Buffer.from('justanidwithoutseparator').toString('base64');
    expect(decodeDescCursor(noColon)).toBeNull();
  });

  it('returns null when the timestamp portion is not a finite positive number', () => {
    const badMs = Buffer.from('NaN:aabbccddeeff00112233445566').toString('base64');
    expect(decodeDescCursor(badMs)).toBeNull();

    const negativeMs = Buffer.from('-1:aabbccddeeff00112233445566').toString('base64');
    expect(decodeDescCursor(negativeMs)).toBeNull();
  });

  it('returns null when the id portion is empty', () => {
    const emptyId = Buffer.from('1700000000000:').toString('base64');
    expect(decodeDescCursor(emptyId)).toBeNull();
  });
});

describe('buildDescCursorPage', () => {
  const items = [
    { name: 'newest', key: 'k3' },
    { name: 'middle', key: 'k2' },
    { name: 'oldest', key: 'k1' },
  ];

  it('returns all items and null nextCursor when results fit within the limit', () => {
    const page = buildDescCursorPage(items, 3, (i) => i.key);

    expect(page.items).toEqual(items);
    expect(page.nextCursor).toBeNull();
  });

  it('returns only `limit` items and a nextCursor when more results exist', () => {
    const page = buildDescCursorPage(items, 2, (i) => i.key);

    expect(page.items).toEqual([items[0], items[1]]);
    expect(page.nextCursor).toBe('k2');
  });
});

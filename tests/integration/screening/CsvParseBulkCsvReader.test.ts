import { writeFile, mkdir, unlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CsvParseBulkCsvReader } from '../../../src/modules/screening/infrastructure/adapters/outbound/csv/CsvParseBulkCsvReader.js';

const TMP = join(tmpdir(), 'bss-test-reader');

async function writeTmp(name: string, content: string): Promise<string> {
  await mkdir(TMP, { recursive: true });
  const filePath = join(TMP, name);
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('CsvParseBulkCsvReader', () => {
  let reader: CsvParseBulkCsvReader;

  beforeEach(() => {
    reader = new CsvParseBulkCsvReader();
  });

  it('yields all data rows from a valid CSV with customer_id header', async () => {
    const filePath = await writeTmp('valid.csv', [
      'customer_id,entry_type,name,document,wallet_address',
      'cust-1,PERSON,Alice Smith,DOC001,',
      'cust-2,ORGANIZATION,Acme Corp,,',
    ].join('\n'));

    const rows: unknown[] = [];
    for await (const row of reader.readRows(filePath)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ customer_id: 'cust-1', entry_type: 'PERSON', name: 'Alice Smith' });
    expect(rows[1]).toMatchObject({ customer_id: 'cust-2', entry_type: 'ORGANIZATION', name: 'Acme Corp' });

    await unlink(filePath);
  });

  it('throws CSV_HEADER_INVALID when customer_id column is missing from header', async () => {
    const filePath = await writeTmp('no-cid.csv', [
      'entry_type,name,document',
      'PERSON,Alice Smith,DOC001',
    ].join('\n'));

    await expect(async () => {
      for await (const _row of reader.readRows(filePath)) {
        // should throw before yielding
      }
    }).rejects.toMatchObject({ code: 'CSV_HEADER_INVALID' });

    await unlink(filePath);
  });

  it('throws CSV_HEADER_INVALID for a header-only CSV without customer_id', async () => {
    const filePath = await writeTmp('header-only-no-cid.csv', 'entry_type,name\n');

    await expect(async () => {
      for await (const _row of reader.readRows(filePath)) {
        // should throw before yielding
      }
    }).rejects.toMatchObject({ code: 'CSV_HEADER_INVALID' });

    await unlink(filePath);
  });

  it('yields a row with empty customer_id without throwing (worker handles as row error)', async () => {
    const filePath = await writeTmp('empty-cid.csv', [
      'customer_id,entry_type,name',
      ',PERSON,Bob',
    ].join('\n'));

    const rows: unknown[] = [];
    for await (const row of reader.readRows(filePath)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(1);
    expect((rows[0] as Record<string, string>).customer_id).toBe('');

    await unlink(filePath);
  });

  it('throws on unreadable (non-existent) file', async () => {
    const filePath = join(TMP, 'does-not-exist.csv');
    await expect(async () => {
      for await (const _row of reader.readRows(filePath)) {
        // should throw
      }
    }).rejects.toThrow();
  });

  it('yields zero rows and no error for a header-only CSV with customer_id column', async () => {
    const filePath = await writeTmp('header-only.csv', 'customer_id,name\n');

    const rows: unknown[] = [];
    for await (const row of reader.readRows(filePath)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(0);

    await unlink(filePath);
  });

  it('discard unlinks the file', async () => {
    const filePath = await writeTmp('to-discard.csv', 'customer_id\ncust-1\n');
    expect(await exists(filePath)).toBe(true);

    await reader.discard(filePath);

    expect(await exists(filePath)).toBe(false);
  });
});

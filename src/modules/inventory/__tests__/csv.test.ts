import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../platform/index';
import { MAX_IMPORT_ROWS, parseStockCsv } from '../domain/csv';

const HEADER = 'sku,quantity,mode';
const BOM = '\uFEFF';
const NUL = String.fromCharCode(0);

describe('inventory/csv — happy path', () => {
  it('parses a plain file', () => {
    const result = parseStockCsv(`${HEADER}\nABC-1,10,set\nABC-2,-3,delta\n`, 'set');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, sku: 'ABC-1', quantity: 10, mode: 'set' },
      { line: 3, sku: 'ABC-2', quantity: -3, mode: 'delta' },
    ]);
  });

  it('falls back to the chosen mode when the column is absent', () => {
    const result = parseStockCsv('sku,quantity\nABC-1,10\n', 'delta');
    expect(result.rows[0]).toMatchObject({ mode: 'delta' });
  });

  // What Excel's "Save as → CSV UTF-8" actually writes.
  it('handles a BOM, CRLF line endings and quoted fields', () => {
    const result = parseStockCsv(`${BOM}sku,quantity\r\n"ABC-1","10"\r\n`, 'set');
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ sku: 'ABC-1', quantity: 10 });
  });

  it('accepts common header spellings and semicolon separators', () => {
    const result = parseStockCsv('Barcode;Qty\n8901030865278;42\n', 'set');
    expect(result.rows[0]).toMatchObject({ sku: '8901030865278', quantity: 42 });
  });

  it('upper-cases SKUs and skips blank lines', () => {
    const result = parseStockCsv(`${HEADER}\n\nabc-1,5,set\n\n`, 'set');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.sku).toBe('ABC-1');
  });
});

describe('inventory/csv — per-row errors carry their line number', () => {
  it('reports each bad row without throwing', () => {
    const result = parseStockCsv(
      [HEADER, 'ABC-1,10,set', ',5,set', 'ABC-3,abc,set', 'ABC-4,1,sideways', 'ABC-5,-1,set'].join(
        '\n',
      ),
      'set',
    );

    expect(result.rows.map((r) => r.sku)).toEqual(['ABC-1']);
    expect(result.errors).toEqual([
      { line: 3, sku: null, message: 'Missing SKU' },
      { line: 4, sku: 'ABC-3', message: 'Quantity must be a whole number, not "abc"' },
      { line: 5, sku: 'ABC-4', message: 'Mode must be "set" or "delta", not "sideways"' },
      { line: 6, sku: 'ABC-5', message: 'A "set" quantity cannot be negative' },
    ]);
  });

  // Two answers for one quantity; applying either silently is a coin toss.
  it('refuses a file that names the same SKU twice', () => {
    const result = parseStockCsv(`${HEADER}\nABC-1,10,set\nabc-1,20,set\n`, 'set');
    expect(result.rows).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      line: 3,
      sku: 'ABC-1',
      message: 'Duplicate SKU — already on line 2',
    });
  });

  it('allows a negative delta but not a negative set', () => {
    const result = parseStockCsv(`${HEADER}\nABC-1,-5,delta\nABC-2,-5,set\n`, 'set');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ quantity: -5, mode: 'delta' });
    expect(result.errors).toHaveLength(1);
  });
});

describe('inventory/csv — whole-file rejections', () => {
  it('refuses a file with no usable header', () => {
    expect(() => parseStockCsv('name,price\nfoo,1\n', 'set')).toThrow(/header/i);
    expect(() => parseStockCsv('', 'set')).toThrow(ValidationError);
  });

  it('refuses a header with no rows', () => {
    expect(() => parseStockCsv(`${HEADER}\n\n`, 'set')).toThrow(/no rows/i);
  });

  // A .xlsx is a ZIP and a legacy .xls is an OLE2 document. Recognising the
  // signature and saying "export as CSV" beats a hundred lines of mojibake.
  it('refuses a spreadsheet file by its signature', () => {
    const xlsx = '\u0050\u004b\u0003\u0004' + 'rest of a zip';
    const xls = '\u00d0\u00cf\u0011\u00e0' + 'rest of an ole2 doc';
    expect(() => parseStockCsv(xlsx, 'set')).toThrow(/export it as csv/i);
    expect(() => parseStockCsv(xls, 'set')).toThrow(/export it as csv/i);
  });

  it('refuses binary content', () => {
    expect(() => parseStockCsv(`${HEADER}\nABC${NUL}-1,1,set`, 'set')).toThrow(/not a text csv/i);
  });

  it('refuses a file over the size guard', () => {
    expect(() => parseStockCsv(`${HEADER}\nABC-1,1,set`, 'set', 5 * 1024 * 1024)).toThrow(
      /larger than/i,
    );
  });

  it('stops at the row-count guard rather than reading on', () => {
    const many = [HEADER, ...Array.from({ length: MAX_IMPORT_ROWS + 10 }, (_, i) => `S${i},1,set`)];
    const result = parseStockCsv(many.join('\n'), 'set');

    expect(result.rows.length + result.errors.length).toBeLessThanOrEqual(MAX_IMPORT_ROWS + 1);
    expect(result.errors.at(-1)?.message).toMatch(/split the file/i);
  });
});

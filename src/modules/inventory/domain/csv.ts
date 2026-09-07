/**
 * Stock-import file parsing. Pure — no I/O, no Prisma.
 *
 * ## Why this is hand-written rather than a dependency
 *
 * The format is three columns of ASCII with no embedded newlines in practice,
 * and the parser below is ~60 lines. Pulling in a CSV library for that would add
 * supply-chain surface to a path that accepts an uploaded file from a browser —
 * the exact place you least want an unaudited transitive dependency (§20).
 *
 * ## Excel
 *
 * `.xlsx` is a ZIP of XML and cannot be read without a real dependency. The
 * common ones (SheetJS on npm) carry open prototype-pollution and ReDoS
 * advisories, which the `npm audit` gate would fail. So this accepts **CSV**,
 * including the CSV that Excel's own "Save as → CSV UTF-8" produces (BOM,
 * CRLF and quoted fields are all handled). Binary `.xlsx` is rejected with a
 * message telling the operator to export as CSV. Adding a spreadsheet parser is
 * a dependency decision for Michael, not something to slip in here.
 */
import { ValidationError } from '../../platform/index';

/** `set` writes an absolute quantity; `delta` adds a signed one. */
export type ImportMode = 'set' | 'delta';

export const IMPORT_MODES: readonly ImportMode[] = ['set', 'delta'];

/** Guards, so a stray upload cannot exhaust memory or the transaction. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5_000;

export interface ParsedRow {
  /** 1-based line number in the original file, for the error report. */
  readonly line: number;
  readonly sku: string;
  readonly quantity: number;
  readonly mode: ImportMode;
}

export interface RowError {
  readonly line: number;
  readonly sku: string | null;
  readonly message: string;
}

export interface ParseResult {
  readonly rows: readonly ParsedRow[];
  readonly errors: readonly RowError[];
}

/** A malformed line, reported by row and column rather than silently repaired. */
export class CsvSyntaxError extends Error {
  constructor(
    readonly column: number,
    message: string,
  ) {
    super(message);
    this.name = 'CsvSyntaxError';
  }
}

/**
 * Split one CSV line on a **single, chosen** delimiter, honouring quotes and
 * doubled quotes inside them — and refusing anything malformed.
 *
 * The previous version treated `,`, `;` and tab as separators everywhere and
 * simply ran off the end of an unterminated quote, so `,"150` parsed as the
 * number 150 with no error at all and was applied to stock. A quoting mistake in
 * a spreadsheet export is exactly the kind of thing that should stop an import,
 * not be guessed at: the three cases below are all silent data corruption if
 * accepted.
 */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  let quotedFieldClosed = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          quotedFieldClosed = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === delimiter) {
      out.push(field);
      field = '';
      quotedFieldClosed = false;
      continue;
    }

    if (char === '"') {
      if (quotedFieldClosed || field !== '') {
        throw new CsvSyntaxError(i + 1, 'A quote may only start a field');
      }
      inQuotes = true;
      continue;
    }

    // Anything after a closing quote other than the delimiter is a mistake —
    // `"12"3` is not the number 123, it is a broken field.
    if (quotedFieldClosed && char !== undefined && char.trim() !== '') {
      throw new CsvSyntaxError(i + 1, 'Unexpected text after a closing quote');
    }
    field += char;
  }

  if (inQuotes) {
    throw new CsvSyntaxError(
      line.length,
      'Unterminated quote — a field opens a quote and never closes it',
    );
  }

  out.push(field);
  return out.map((value) => value.trim());
}

/**
 * Pick one delimiter for the whole file, from the header.
 *
 * Accepting all three everywhere meant a comma inside a semicolon-separated file
 * silently split a field. The header names the columns, so whichever candidate
 * yields the most fields there is the file's delimiter, and it is used for every
 * row after.
 */
function chooseDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = headerLine.split(candidate).length;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Reject a file that is not text before trying to read it as one.
 *
 * A `.xlsx` is a ZIP (`PK\x03\x04`); a NUL byte anywhere is a reliable sign of
 * binary. Saying "export as CSV" is far more useful than a hundred rows of
 * mojibake errors.
 */
const SPREADSHEET_SIGNATURES: readonly string[] = [
  // .xlsx / .ods — a ZIP container.
  '\u0050\u004b\u0003\u0004',
  // Legacy .xls — an OLE2 compound document.
  '\u00d0\u00cf\u0011\u00e0',
];

function assertLooksTextual(content: string, byteLength: number): void {
  if (byteLength > MAX_IMPORT_BYTES) {
    throw new ValidationError(
      `That file is larger than ${String(Math.floor(MAX_IMPORT_BYTES / 1024))} KB`,
      { byteLength },
    );
  }
  if (SPREADSHEET_SIGNATURES.some((signature) => content.startsWith(signature))) {
    throw new ValidationError(
      'That looks like a spreadsheet file. Export it as CSV and upload that.',
      {},
    );
  }
  if (content.includes(String.fromCharCode(0))) {
    throw new ValidationError('That file is not a text CSV', {});
  }
}

const HEADER_ALIASES: Readonly<Record<string, 'sku' | 'quantity' | 'mode'>> = {
  sku: 'sku',
  barcode: 'sku',
  code: 'sku',
  quantity: 'quantity',
  qty: 'quantity',
  stock: 'quantity',
  count: 'quantity',
  mode: 'mode',
  operation: 'mode',
};

/**
 * Parse a stock-import CSV.
 *
 * Never throws for a *row* problem — a bad row becomes a `RowError` carrying its
 * line number, so the operator gets one report naming every mistake instead of
 * fixing them one upload at a time. Only whole-file problems (binary, too big,
 * no usable header) throw.
 */
export function parseStockCsv(
  content: string,
  defaultMode: ImportMode,
  byteLength = Buffer.byteLength(content, 'utf8'),
): ParseResult {
  assertLooksTextual(content, byteLength);

  // Strip the BOM Excel writes on "CSV UTF-8", then accept CRLF or LF.
  const text = content.replace(/^\uFEFF/, '');
  const lines = text.split(/\r\n|\n|\r/);

  let headerIndex = -1;
  let columns: { sku: number; quantity: number; mode: number } | null = null;
  let delimiter = ',';

  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    delimiter = chooseDelimiter(line);
    let cells: string[];
    try {
      cells = splitLine(line, delimiter).map((cell) => cell.toLowerCase());
    } catch (error) {
      if (error instanceof CsvSyntaxError) {
        throw new ValidationError(
          `The header row is malformed: ${error.message} (column ${String(error.column)})`,
          {},
        );
      }
      throw error;
    }
    const sku = cells.findIndex((cell) => HEADER_ALIASES[cell] === 'sku');
    const quantity = cells.findIndex((cell) => HEADER_ALIASES[cell] === 'quantity');
    if (sku !== -1 && quantity !== -1) {
      headerIndex = index;
      columns = {
        sku,
        quantity,
        mode: cells.findIndex((cell) => HEADER_ALIASES[cell] === 'mode'),
      };
    }
    break;
  }

  if (columns === null) {
    throw new ValidationError(
      'The first row must be a header naming at least "sku" and "quantity"',
      {},
    );
  }

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    if (raw.trim() === '') continue;

    const line = index + 1;
    if (rows.length + errors.length >= MAX_IMPORT_ROWS) {
      errors.push({
        line,
        sku: null,
        message: `More than ${String(MAX_IMPORT_ROWS)} rows — split the file`,
      });
      break;
    }

    let cells: string[];
    try {
      cells = splitLine(raw, delimiter);
    } catch (error) {
      // A quoting mistake is a row error with a column, not a silent repair.
      if (error instanceof CsvSyntaxError) {
        errors.push({
          line,
          sku: null,
          message: `${error.message} (column ${String(error.column)})`,
        });
        continue;
      }
      throw error;
    }

    const sku = (cells[columns.sku] ?? '').toUpperCase();
    const quantityText = cells[columns.quantity] ?? '';
    const modeText = (columns.mode === -1 ? '' : (cells[columns.mode] ?? '')).toLowerCase();

    if (sku === '') {
      errors.push({ line, sku: null, message: 'Missing SKU' });
      continue;
    }

    // A file that names the same SKU twice has two answers for one quantity;
    // applying either silently would be a coin toss.
    const earlier = seen.get(sku);
    if (earlier !== undefined) {
      errors.push({ line, sku, message: `Duplicate SKU — already on line ${String(earlier)}` });
      continue;
    }
    seen.set(sku, line);

    const mode =
      modeText === '' ? defaultMode : modeText === 'set' || modeText === 'delta' ? modeText : null;
    if (mode === null) {
      errors.push({ line, sku, message: `Mode must be "set" or "delta", not "${modeText}"` });
      continue;
    }

    if (!/^-?\d+$/.test(quantityText)) {
      errors.push({
        line,
        sku,
        message: `Quantity must be a whole number, not "${quantityText}"`,
      });
      continue;
    }

    const quantity = Number(quantityText);
    if (mode === 'set' && quantity < 0) {
      errors.push({ line, sku, message: 'A "set" quantity cannot be negative' });
      continue;
    }
    if (!Number.isSafeInteger(quantity)) {
      errors.push({ line, sku, message: 'That quantity is out of range' });
      continue;
    }

    rows.push({ line, sku, quantity, mode });
  }

  if (rows.length === 0 && errors.length === 0) {
    throw new ValidationError('That file has a header but no rows', {});
  }

  return { rows, errors };
}

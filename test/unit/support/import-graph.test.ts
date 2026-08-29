import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  buildImportGraph,
  ComputedSpecifierError,
  extractModuleReferences,
  filesUnder,
  moduleSpecifiers,
  packagesMatching,
  UnresolvedModuleError,
} from '../../support/import-graph';

/**
 * Tests for the guard itself.
 *
 * The boundary suites are only as good as this walker: if it misses an import
 * form, every "never reaches X" assertion built on it is vacuous. That is
 * exactly how the regex it replaced failed review finding S-3 — it extracted
 * zero specifiers from a file with three live module references.
 *
 * So this file is deliberately paranoid. Every import form the language offers
 * gets an example, and each is asserted to be *found*, not merely "not crash".
 * The three forms named in the finding are pinned by name at the bottom.
 */

/* ── Extraction: one case per form ──────────────────────────────────────── */

type Case = {
  readonly form: string;
  readonly source: string;
  readonly expected: readonly string[];
};

const CASES: Case[] = [
  {
    form: 'a default import',
    source: `import Dexie from 'dexie';\n`,
    expected: ['dexie'],
  },
  {
    form: 'a named import',
    source: `import { getAuth } from 'firebase/auth';\n`,
    expected: ['firebase/auth'],
  },
  {
    form: 'a namespace import',
    source: `import * as crypto from './crypto';\n`,
    expected: ['./crypto'],
  },
  {
    form: 'a side-effect-only import',
    source: `import './register-worker';\n`,
    expected: ['./register-worker'],
  },
  {
    form: 'a type-only import',
    source: `import type { Table } from 'dexie';\n`,
    expected: ['dexie'],
  },
  {
    form: 'an inline type import',
    source: `import { type Table, liveQuery } from 'dexie';\n`,
    expected: ['dexie'],
  },
  {
    form: 'a re-export of everything',
    source: `export * from './record-cipher';\n`,
    expected: ['./record-cipher'],
  },
  {
    form: 'a namespaced re-export',
    source: `export * as cipher from './record-cipher';\n`,
    expected: ['./record-cipher'],
  },
  {
    form: 'a named re-export',
    source: `export { seal } from './record-cipher';\n`,
    expected: ['./record-cipher'],
  },
  {
    form: 'a type-only re-export',
    source: `export type { Sealed } from './record-cipher';\n`,
    expected: ['./record-cipher'],
  },
  {
    form: 'an import-equals require',
    source: `import legacy = require('./legacy');\n`,
    expected: ['./legacy'],
  },
  {
    form: 'a CommonJS require call',
    source: `const legacy = require('./legacy');\n`,
    expected: ['./legacy'],
  },
  {
    form: 'a dynamic import of a string literal',
    source: `await import('firebase/app');\n`,
    expected: ['firebase/app'],
  },
  {
    // Defeated the regex: it only looked for quote characters after `import(`.
    form: 'a dynamic import of a template literal',
    source: 'await import(`./secret-channel`);\n',
    expected: ['./secret-channel'],
  },
  {
    // Defeated the regex: the comment sat between `import(` and the quote.
    form: 'a dynamic import with an interposed comment',
    source: `await import(/* webpackIgnore: true */ './secret-channel');\n`,
    expected: ['./secret-channel'],
  },
  {
    // Defeated the regex: no `import` or `require` token anywhere near it.
    form: 'a new URL(..., import.meta.url) module reference',
    source: `const worker = new URL('./secret-worker.ts', import.meta.url);\n`,
    expected: ['./secret-worker.ts'],
  },
  {
    form: 'an aliased import',
    source: `import { seal } from '~/crypto/record-cipher';\n`,
    expected: ['~/crypto/record-cipher'],
  },
  {
    form: 'a deferred (lazy) dynamic import inside a callback',
    source: `const load = () => import('./panel').then((m) => m.Panel);\n`,
    expected: ['./panel'],
  },
  {
    form: 'imports written inside JSX-bearing TSX',
    source: `import { useState } from 'react';\nexport const C = () => <p>{useState(0)[0]}</p>;\n`,
    expected: ['react'],
  },
];

describe('extractModuleReferences finds every import form', () => {
  it.each(CASES)('finds $form', ({ source, expected, form }) => {
    const fileName = form.includes('TSX') ? 'component.tsx' : 'module.ts';
    const { references, computed } = extractModuleReferences(source, fileName);
    expect(computed).toEqual([]);
    expect(references.map((r) => r.specifier)).toEqual(expected);
  });

  it('covers each reference kind at least once', () => {
    const kinds = new Set(
      CASES.flatMap(({ source, form }) =>
        extractModuleReferences(
          source,
          form.includes('TSX') ? 'component.tsx' : 'module.ts',
        ).references.map((r) => r.kind),
      ),
    );
    expect([...kinds].sort()).toEqual([
      'dynamic-import',
      'import-equals',
      'module-url',
      'require',
      'static-export',
      'static-import',
    ]);
  });

  it('flags type-only forms as such without dropping them', () => {
    const { references } = extractModuleReferences(
      `import type { Table } from 'dexie';\nexport type { Sealed } from './x';\n`,
    );
    expect(references.map((r) => [r.specifier, r.typeOnly])).toEqual([
      ['dexie', true],
      ['./x', true],
    ]);
  });

  it('reports the line each reference sits on', () => {
    const { references } = extractModuleReferences(
      `// header\nimport 'a';\n\nimport 'b';\n`,
    );
    expect(references.map((r) => [r.specifier, r.line])).toEqual([
      ['a', 2],
      ['b', 4],
    ]);
  });

  it('ignores a call to something merely named like an import', () => {
    const { references, computed } = extractModuleReferences(
      `const importer = { require: (s: string) => s };\nimporter.require('./not-an-edge');\nconst u = new URL('https://example.test/x');\n`,
    );
    expect(references).toEqual([]);
    expect(computed).toEqual([]);
  });

  it('does not see a specifier inside a comment or a plain string', () => {
    const { references } = extractModuleReferences(
      `// import 'dexie';\n/* import 'firebase/auth'; */\nconst s = "import 'react'";\n`,
    );
    expect(references).toEqual([]);
  });
});

describe('extractModuleReferences refuses to guess', () => {
  it.each([
    ['a computed dynamic import', 'await import(name);\n'],
    [
      'a template literal with a substitution',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test, not a string to expand
      'await import(`./locales/${locale}`);\n',
    ],
    ['a computed require', 'const m = require(pathFromEnv);\n'],
    [
      'a computed new URL module reference',
      'const w = new URL(entry, import.meta.url);\n',
    ],
  ])('reports %s as computed rather than dropping it', (_name, source) => {
    const { references, computed } = extractModuleReferences(source);
    expect(references).toEqual([]);
    expect(computed).toHaveLength(1);
  });

  it('makes moduleSpecifiers throw on a computed specifier', () => {
    expect(() => moduleSpecifiers('await import(name);\n', 'a.ts')).toThrow(
      ComputedSpecifierError,
    );
  });

  it('returns plain specifier strings when everything is literal', () => {
    expect(moduleSpecifiers(`import 'dexie';\nexport * from './x';\n`)).toEqual(
      ['dexie', './x'],
    );
  });
});

/* ── Graph walking, against a real file tree ────────────────────────────── */

const root = mkdtempSync(join(tmpdir(), 'cifra-import-graph-'));

afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, source: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, source, 'utf8');
}

const options = { root, alias: { '~/': 'app/' } } as const;

write(
  'app/entry.ts',
  [
    `import './static-leaf';`,
    `export * from './re-exported';`,
    `export { named } from './named-re-export';`,
    `import type { T } from './type-only';`,
    `import '~/aliased';`,
    `const lazy = () => import('./dynamic-literal');`,
    'const templated = () => import(`./dynamic-template`);',
    `const commented = () => import(/* c */ './dynamic-commented');`,
    `const worker = new URL('./url-referenced.ts', import.meta.url);`,
    `import Dexie from 'dexie';`,
    `import { getAuth } from 'firebase/auth';`,
    `export const used = [lazy, templated, commented, worker, Dexie, getAuth];`,
    `export type Alias = T;`,
  ].join('\n'),
);
write('app/static-leaf.ts', `import './leaf-of-leaf';\n`);
write('app/leaf-of-leaf.ts', `export const deep = 1;\n`);
write('app/re-exported.ts', `export const a = 1;\n`);
write('app/named-re-export.ts', `export const named = 1;\n`);
write('app/type-only.ts', `export type T = string;\n`);
write('app/aliased/index.ts', `export const aliased = 1;\n`);
write('app/dynamic-literal.ts', `export const one = 1;\n`);
write('app/dynamic-template.ts', `export const two = 2;\n`);
write('app/dynamic-commented.ts', `export const three = 3;\n`);
write('app/url-referenced.ts', `export const four = 4;\n`);

write('app/cycle-a.ts', `import './cycle-b';\nexport const a = 1;\n`);
write('app/cycle-b.ts', `import './cycle-a';\nexport const b = 1;\n`);

write('app/broken.ts', `import './does-not-exist';\n`);
write('app/broken-alias.ts', `import '~/nowhere/at/all';\n`);
// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text the walker must refuse, not expand
write('app/computed.ts', 'await import(`./locales/${locale}`);\n');

describe('buildImportGraph', () => {
  const graph = buildImportGraph('app/entry.ts', options);

  it('reaches every module, whatever form referenced it', () => {
    expect([...graph.files].sort()).toEqual([
      'app/aliased/index.ts',
      'app/dynamic-commented.ts',
      'app/dynamic-literal.ts',
      'app/dynamic-template.ts',
      'app/entry.ts',
      'app/leaf-of-leaf.ts',
      'app/named-re-export.ts',
      'app/re-exported.ts',
      'app/static-leaf.ts',
      'app/type-only.ts',
      'app/url-referenced.ts',
    ]);
  });

  it('follows transitively, not just one level deep', () => {
    expect(graph.files).toContain('app/leaf-of-leaf.ts');
  });

  it('resolves a directory through its index file', () => {
    expect(graph.files).toContain('app/aliased/index.ts');
  });

  it('collects bare specifiers as packages, not files', () => {
    expect([...graph.packages].sort()).toEqual(['dexie', 'firebase/auth']);
  });

  it('matches packages by name and scope, never by prefix', () => {
    expect(packagesMatching(graph, 'firebase')).toEqual(['firebase/auth']);
    expect(packagesMatching(graph, 'dex')).toEqual([]);
  });

  it('filters files by path prefix', () => {
    expect(filesUnder(graph, 'app/dynamic-')).toEqual([
      'app/dynamic-commented.ts',
      'app/dynamic-literal.ts',
      'app/dynamic-template.ts',
    ]);
  });

  it('terminates on an import cycle', () => {
    const cyclic = buildImportGraph('app/cycle-a.ts', options);
    expect([...cyclic.files].sort()).toEqual([
      'app/cycle-a.ts',
      'app/cycle-b.ts',
    ]);
  });

  it('records the references it read, per file', () => {
    expect(graph.references.get('app/static-leaf.ts')).toEqual([
      {
        specifier: './leaf-of-leaf',
        kind: 'static-import',
        line: 1,
        typeOnly: false,
      },
    ]);
  });
});

describe('buildImportGraph fails loudly rather than walking a partial graph', () => {
  it('throws on an unresolvable relative import', () => {
    expect(() => buildImportGraph('app/broken.ts', options)).toThrow(
      UnresolvedModuleError,
    );
  });

  it('throws on an unresolvable aliased import', () => {
    expect(() => buildImportGraph('app/broken-alias.ts', options)).toThrow(
      /unresolved local import "~\/nowhere\/at\/all"/,
    );
  });

  it('throws on a computed dynamic specifier', () => {
    expect(() => buildImportGraph('app/computed.ts', options)).toThrow(
      ComputedSpecifierError,
    );
  });

  it('throws on a missing entry point', () => {
    expect(() => buildImportGraph('app/nope.ts', options)).toThrow(
      UnresolvedModuleError,
    );
  });
});

/* ── The three forms that defeated the regex (finding S-3) ──────────────── */

describe('the forms review finding S-3 demonstrated', () => {
  const REGEX_BLIND_SPOTS = [
    'await import(`./secret-channel`);',
    `await import(/* keep */ './secret-channel');`,
    `const w = new URL('./secret-worker.ts', import.meta.url);`,
  ].join('\n');

  it('extracts three specifiers from the file that yielded zero', () => {
    const { references, computed } = extractModuleReferences(
      REGEX_BLIND_SPOTS,
      'blind-spots.ts',
    );
    expect(computed).toEqual([]);
    expect(references.map((r) => r.specifier)).toEqual([
      './secret-channel',
      './secret-channel',
      './secret-worker.ts',
    ]);
  });

  it('the regex it replaced really did find none of them', () => {
    // Verbatim from the two suites before this change, kept as the record of
    // what was wrong. If someone reintroduces it, this shows the cost.
    const OLD =
      /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;
    expect([...REGEX_BLIND_SPOTS.matchAll(OLD)]).toEqual([]);
  });
});

/**
 * Mechanical enforcement of the layer contract for the db and crypto layers.
 *
 * CLAUDE.md: "**Layer contract:** services never import React; crypto never
 * imports Dexie." `docs/architecture.md` §Stack and layering:
 * `… → db (Dexie 4 + middleware) → crypto (Web Crypto)`. The arrow only points
 * one way, and it is otherwise enforced only by a reviewer noticing.
 *
 * This walks the *real* import graph of every module in both layers, so an edit
 * that pulls Dexie into the crypto layer — or React into the db layer — fails
 * CI instead of relying on attention. The walker follows the same pattern as
 * `test/unit/auth-boundary.test.ts` (issue #8), including its anti-vacuity
 * guards; it is duplicated rather than shared because that suite is on an
 * unmerged branch.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

interface ImportGraph {
  /** Every local file reachable from the entry point, repo-relative. */
  readonly files: ReadonlySet<string>;
  /** Every bare (node_modules) specifier reachable from the entry point. */
  readonly packages: ReadonlySet<string>;
}

/** Matches static imports/exports and dynamic `import()` calls. */
const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;

function readSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  for (const extension of RESOLVE_EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function buildImportGraph(entry: string): ImportGraph {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [resolve(REPO_ROOT, entry)];

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) continue;

    const key = relative(REPO_ROOT, current);
    if (files.has(key)) continue;
    files.add(key);

    for (const specifier of readSpecifiers(readFileSync(current, 'utf8'))) {
      const relativeSpecifier = specifier.startsWith('~/')
        ? null
        : specifier.startsWith('.')
          ? specifier
          : undefined;
      if (relativeSpecifier === undefined) {
        packages.add(specifier);
        continue;
      }
      const resolved =
        relativeSpecifier === null
          ? resolveLocal(resolve(REPO_ROOT, 'app/x'), `./${specifier.slice(2)}`)
          : resolveLocal(current, relativeSpecifier);
      // An unresolvable local import means the walker is blind to part of the
      // graph, which would make every assertion below vacuous. Fail loudly.
      expect(
        resolved,
        `unresolved local import "${specifier}" in ${key}`,
      ).not.toBeNull();
      if (resolved !== null) queue.push(resolved);
    }
  }

  return { files, packages };
}

function modulesIn(directory: string): string[] {
  return readdirSync(resolve(REPO_ROOT, directory))
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .map((entry) => `${directory}/${entry}`)
    .sort();
}

const CRYPTO_MODULES = modulesIn('app/crypto');
const DB_MODULES = modulesIn('app/db');

function reaches(graph: ImportGraph, ...names: string[]): string[] {
  return [...graph.packages]
    .filter((specifier) =>
      names.some(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      ),
    )
    .sort();
}

describe('the walker sees the layers it claims to check', () => {
  it('found both layers', () => {
    expect(CRYPTO_MODULES).toEqual([
      'app/crypto/bytes.ts',
      'app/crypto/kdf.ts',
      'app/crypto/key-wrap.ts',
      'app/crypto/record-cipher.ts',
    ]);
    expect(DB_MODULES.length).toBeGreaterThanOrEqual(5);
  });

  it('walks past the entry file into real dependencies', () => {
    const graph = buildImportGraph('app/db/database.ts');
    expect(graph.files.size).toBeGreaterThan(1);
    expect(graph.files).toContain('app/db/encryption-middleware.ts');
    expect(graph.files).toContain('app/db/schema.ts');
  });

  it('finds Dexie and the crypto layer from the database (positive control)', () => {
    // If this fails, either the db layer stopped using Dexie or the specifier
    // scanner is broken — in which case the negative assertions below prove
    // nothing. This test is the canary for that.
    const graph = buildImportGraph('app/db/database.ts');
    expect(reaches(graph, 'dexie')).toEqual(['dexie']);
    expect(graph.files).toContain('app/crypto/record-cipher.ts');
    expect(graph.files).toContain('app/crypto/key-wrap.ts');
  });
});

describe('crypto never imports Dexie', () => {
  it.each(CRYPTO_MODULES)('%s reaches no database driver', (entry) => {
    const graph = buildImportGraph(entry);
    expect(reaches(graph, 'dexie', 'idb', 'fake-indexeddb')).toEqual([]);
  });

  it.each(CRYPTO_MODULES)('%s reaches nothing in app/db', (entry) => {
    const graph = buildImportGraph(entry);
    expect(
      [...graph.files].filter((file) => file.startsWith('app/db/')),
    ).toEqual([]);
  });

  it.each(CRYPTO_MODULES)('%s reaches no UI framework', (entry) => {
    const graph = buildImportGraph(entry);
    expect(reaches(graph, 'react', 'react-dom', 'react-router')).toEqual([]);
  });
});

describe('the db layer never imports React', () => {
  it.each(DB_MODULES)('%s reaches no UI framework', (entry) => {
    const graph = buildImportGraph(entry);
    expect(reaches(graph, 'react', 'react-dom', 'react-router')).toEqual([]);
  });

  it.each(DB_MODULES)('%s reaches no route or component module', (entry) => {
    const graph = buildImportGraph(entry);
    const ui = [...graph.files].filter(
      (file) => file.startsWith('app/routes/') || file === 'app/root.tsx',
    );
    expect(ui).toEqual([]);
  });

  it.each(DB_MODULES)('%s reaches no Firebase SDK', (entry) => {
    // CLAUDE.md: "Firebase is auth only. No financial data in Firestore, ever."
    const graph = buildImportGraph(entry);
    expect(reaches(graph, 'firebase', '@firebase')).toEqual([]);
  });
});

describe('only the db layer talks to Dexie', () => {
  it('confines the Dexie import to app/db', () => {
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(resolve(REPO_ROOT, directory), {
        withFileTypes: true,
      })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (path.startsWith('app/db/')) continue;
        const source = readFileSync(resolve(REPO_ROOT, path), 'utf8');
        if (readSpecifiers(source).some((s) => s === 'dexie')) {
          offenders.push(path);
        }
      }
    };
    walk('app');
    expect(offenders).toEqual([]);
  });
});

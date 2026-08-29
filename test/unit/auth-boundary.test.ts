import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Mechanical enforcement of the identity/vault boundary.
 *
 * docs/architecture.md §Crypto, key hierarchy step 1: identity is "identity
 * only; it never touches encryption material". CLAUDE.md pins the layer
 * contract. Both are otherwise enforced only by a reviewer noticing — this
 * suite walks the *real* import graph of the auth modules so a future edit that
 * pulls crypto, Dexie or the Firebase SDK into the session store fails CI
 * instead of relying on attention.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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
  const entryPath = resolve(REPO_ROOT, entry);
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entryPath];

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) continue;

    const key = relative(REPO_ROOT, current);
    if (files.has(key)) continue;
    files.add(key);

    for (const specifier of readSpecifiers(readFileSync(current, 'utf8'))) {
      if (specifier.startsWith('.')) {
        const resolved = resolveLocal(current, specifier);
        // An unresolvable relative import means the walker is blind to part of
        // the graph, which would make these assertions vacuous. Fail loudly.
        expect(
          resolved,
          `unresolved relative import "${specifier}" in ${key}`,
        ).not.toBeNull();
        if (resolved !== null) queue.push(resolved);
        continue;
      }
      if (specifier.startsWith('~/')) {
        const resolved = resolveLocal(
          resolve(REPO_ROOT, 'app/x'),
          `./${specifier.slice(2)}`,
        );
        expect(
          resolved,
          `unresolved aliased import "${specifier}" in ${key}`,
        ).not.toBeNull();
        if (resolved !== null) queue.push(resolved);
        continue;
      }
      packages.add(specifier);
    }
  }

  return { files, packages };
}

/** Package specifiers that would mean encryption or storage crept into a graph. */
const FORBIDDEN_PACKAGES = ['firebase', 'dexie', 'hash-wasm', 'idb'];

function forbiddenPackagesIn(graph: ImportGraph): string[] {
  return [...graph.packages]
    .filter((specifier) =>
      FORBIDDEN_PACKAGES.some(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      ),
    )
    .sort();
}

function cryptoOrDbFilesIn(graph: ImportGraph): string[] {
  return [...graph.files].filter(
    (file) => file.startsWith('app/crypto/') || file.startsWith('app/db/'),
  );
}

describe('session store import graph', () => {
  const graph = buildImportGraph('app/stores/session.ts');

  it('walks more than the entry file (guards against a vacuous assertion)', () => {
    expect(graph.files.size).toBeGreaterThan(1);
    expect(graph.files).toContain('app/services/auth/auth-error.ts');
    expect(graph.files).toContain('app/services/auth/types.ts');
  });

  it('never reaches app/crypto or app/db', () => {
    expect(cryptoOrDbFilesIn(graph)).toEqual([]);
  });

  it('never reaches the Firebase SDK or a database driver', () => {
    expect(forbiddenPackagesIn(graph)).toEqual([]);
  });

  it('never reaches React — the store is plain TS, bound to React separately', () => {
    expect([...graph.packages]).not.toContain('react');
    expect([...graph.packages]).not.toContain('react-dom');
  });
});

describe('Firebase SDK containment', () => {
  it.each([
    'app/services/auth/types.ts',
    'app/services/auth/auth-error.ts',
    'app/services/auth/firebase-config.ts',
  ])('%s is free of the Firebase SDK', (entry) => {
    const graph = buildImportGraph(entry);
    expect(forbiddenPackagesIn(graph)).toEqual([]);
    expect(cryptoOrDbFilesIn(graph)).toEqual([]);
  });

  it('confines the SDK to the adapter (positive control for the walker)', () => {
    // If this fails, either the adapter stopped importing Firebase or the
    // specifier scanner is broken — in which case every assertion above is
    // meaningless. This test is the canary for that.
    const graph = buildImportGraph('app/services/auth/firebase-auth-port.ts');
    expect(forbiddenPackagesIn(graph)).toEqual([
      'firebase/app',
      'firebase/auth',
    ]);
  });

  it('initialises no Firebase product other than auth', () => {
    const source = readFileSync(
      resolve(REPO_ROOT, 'app/services/auth/firebase-auth-port.ts'),
      'utf8',
    );
    // CLAUDE.md: "Firebase is auth only. No financial data in Firestore, ever."
    for (const banned of [
      'firebase/firestore',
      'firebase/storage',
      'firebase/analytics',
      'firebase/functions',
      'firebase/database',
    ]) {
      expect(source).not.toContain(banned);
    }
  });
});

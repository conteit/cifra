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
 * CI instead of relying on attention.
 *
 * The walker is `test/support/import-graph.ts`, shared with
 * `test/unit/auth-boundary.test.ts`. Both suites used to carry a private copy
 * of a regular expression over the source text; review finding S-3 showed it
 * missed template-literal `import()`, `import(/* c *\/ '…')` and
 * `new URL('…', import.meta.url)` entirely — three ways to smuggle Dexie into
 * `app/crypto` with a green suite. The walker reads the TypeScript AST instead
 * and throws on anything it cannot resolve, so no assertion here can pass by
 * being blind.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  filesUnder,
  moduleSpecifiers,
  packagesMatching,
} from '../../support/import-graph';
import { REPO_ROOT, repoImportGraph } from '../../support/repo-graph';

function modulesIn(directory: string): string[] {
  return readdirSync(resolve(REPO_ROOT, directory))
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .map((entry) => `${directory}/${entry}`)
    .sort();
}

const CRYPTO_MODULES = modulesIn('app/crypto');
const DB_MODULES = modulesIn('app/db');

describe('the walker sees the layers it claims to check', () => {
  it('found both layers', () => {
    expect(CRYPTO_MODULES).toEqual([
      'app/crypto/bytes.ts',
      'app/crypto/kdf-params.ts',
      'app/crypto/kdf-worker-body.ts',
      'app/crypto/kdf-worker-client.ts',
      'app/crypto/kdf-worker.ts',
      'app/crypto/kdf.ts',
      'app/crypto/key-wrap.ts',
      'app/crypto/record-cipher.ts',
    ]);
    expect(DB_MODULES.length).toBeGreaterThanOrEqual(5);
  });

  it('walks past the entry file into real dependencies', () => {
    const graph = repoImportGraph('app/db/database.ts');
    expect(graph.files.size).toBeGreaterThan(1);
    expect(graph.files).toContain('app/db/encryption-middleware.ts');
    expect(graph.files).toContain('app/db/schema.ts');
  });

  it('finds Dexie and the crypto layer from the database (positive control)', () => {
    // If this fails, either the db layer stopped using Dexie or the walker is
    // broken — in which case the negative assertions below prove nothing. This
    // test is the canary for that.
    const graph = repoImportGraph('app/db/database.ts');
    expect(packagesMatching(graph, 'dexie')).toEqual(['dexie']);
    expect(graph.files).toContain('app/crypto/record-cipher.ts');
    expect(graph.files).toContain('app/crypto/key-wrap.ts');
  });
});

describe('crypto never imports Dexie', () => {
  it.each(CRYPTO_MODULES)('%s reaches no database driver', (entry) => {
    const graph = repoImportGraph(entry);
    expect(packagesMatching(graph, 'dexie', 'idb', 'fake-indexeddb')).toEqual(
      [],
    );
  });

  it.each(CRYPTO_MODULES)('%s reaches nothing in app/db', (entry) => {
    expect(filesUnder(repoImportGraph(entry), 'app/db/')).toEqual([]);
  });

  it.each(CRYPTO_MODULES)('%s reaches no UI framework', (entry) => {
    const graph = repoImportGraph(entry);
    expect(
      packagesMatching(graph, 'react', 'react-dom', 'react-router'),
    ).toEqual([]);
  });
});

describe('the db layer never imports React', () => {
  it.each(DB_MODULES)('%s reaches no UI framework', (entry) => {
    const graph = repoImportGraph(entry);
    expect(
      packagesMatching(graph, 'react', 'react-dom', 'react-router'),
    ).toEqual([]);
  });

  it.each(DB_MODULES)('%s reaches no route or component module', (entry) => {
    const graph = repoImportGraph(entry);
    const ui = [...graph.files].filter(
      (file) => file.startsWith('app/routes/') || file === 'app/root.tsx',
    );
    expect(ui).toEqual([]);
  });

  it.each(DB_MODULES)('%s reaches no Firebase SDK', (entry) => {
    // CLAUDE.md: "Firebase is auth only. No financial data in Firestore, ever."
    const graph = repoImportGraph(entry);
    expect(packagesMatching(graph, 'firebase', '@firebase')).toEqual([]);
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
        const absolute = resolve(REPO_ROOT, path);
        // `moduleSpecifiers` throws on a non-literal specifier rather than
        // returning a short list, so "no offenders" cannot mean "unreadable".
        if (
          moduleSpecifiers(readFileSync(absolute, 'utf8'), absolute).some(
            (specifier) => specifier === 'dexie',
          )
        ) {
          offenders.push(path);
        }
      }
    };
    walk('app');
    expect(offenders).toEqual([]);
  });
});

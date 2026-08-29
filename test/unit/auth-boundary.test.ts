import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { filesUnder, packagesMatching } from '../support/import-graph';
import { REPO_ROOT, repoImportGraph } from '../support/repo-graph';

/**
 * Mechanical enforcement of the identity/vault boundary.
 *
 * docs/architecture.md §Crypto, key hierarchy step 1: identity is "identity
 * only; it never touches encryption material". CLAUDE.md pins the layer
 * contract. Both are otherwise enforced only by a reviewer noticing — this
 * suite walks the *real* import graph of the auth modules so a future edit that
 * pulls crypto, Dexie or the Firebase SDK into the session store fails CI
 * instead of relying on attention.
 *
 * The graph is built by `test/support/import-graph.ts`, which reads edges off
 * the TypeScript AST. This suite used to carry its own regular expression over
 * the source text; review finding S-3 showed it extracted zero specifiers from
 * a file with three live module references, so every assertion below was
 * enforcing nothing that a template-literal `import()` could not walk past.
 * The walker has its own tests in `test/unit/support/import-graph.test.ts`,
 * including those three forms.
 *
 * The walker throws rather than skipping when a specifier is unresolvable or
 * not a literal, so an assertion here can never be vacuous by omission.
 */

/** Package specifiers that would mean encryption or storage crept into a graph. */
const FORBIDDEN_PACKAGES = ['firebase', 'dexie', 'hash-wasm', 'idb'];

describe('session store import graph', () => {
  const graph = repoImportGraph('app/stores/session.ts');

  it('walks more than the entry file (guards against a vacuous assertion)', () => {
    expect(graph.files.size).toBeGreaterThan(1);
    expect(graph.files).toContain('app/services/auth/auth-error.ts');
    expect(graph.files).toContain('app/services/auth/types.ts');
  });

  it('never reaches app/crypto or app/db', () => {
    expect(filesUnder(graph, 'app/crypto/', 'app/db/')).toEqual([]);
  });

  it('never reaches the Firebase SDK or a database driver', () => {
    expect(packagesMatching(graph, ...FORBIDDEN_PACKAGES)).toEqual([]);
  });

  it('never reaches React — the store is plain TS, bound to React separately', () => {
    expect(packagesMatching(graph, 'react', 'react-dom')).toEqual([]);
  });
});

describe('Firebase SDK containment', () => {
  it.each([
    'app/services/auth/types.ts',
    'app/services/auth/auth-error.ts',
    'app/services/auth/firebase-config.ts',
    // #44's emulator constants. They are imported by `vite.config.ts` for the
    // production-bundle guard as well as by the adapter, so an SDK import here
    // would pull Firebase into the build config too.
    'app/services/auth/auth-emulator.ts',
    'app/stores/session-test-handle.ts',
  ])('%s is free of the Firebase SDK', (entry) => {
    const graph = repoImportGraph(entry);
    expect(packagesMatching(graph, ...FORBIDDEN_PACKAGES)).toEqual([]);
    expect(filesUnder(graph, 'app/crypto/', 'app/db/')).toEqual([]);
  });

  it('confines the SDK to the adapter (positive control for the walker)', () => {
    // If this fails, either the adapter stopped importing Firebase or the
    // walker is broken — in which case every assertion above is meaningless.
    // This test is the canary for that.
    const graph = repoImportGraph('app/services/auth/firebase-auth-port.ts');
    expect(packagesMatching(graph, ...FORBIDDEN_PACKAGES)).toEqual([
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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DB_TEST_HANDLE } from '../../../app/db/db-test-handle';
import { SESSION_TEST_HANDLE } from '../../../app/stores/session-test-handle';
import { filesUnder, packagesMatching } from '../../support/import-graph';
import { REPO_ROOT, repoImportGraph } from '../../support/repo-graph';

/**
 * The db test seam (#42) is a deliberate hole in the app: a `window` property
 * that hands page code the encrypted database and the vault key hierarchy. It
 * exists because nothing in the app imports `app/db/` yet, so
 * `test/e2e/db-liveness.spec.ts` has nothing to click and the middleware would
 * otherwise never execute in a browser at all.
 *
 * A hole like that is only acceptable while it is *provably* absent from a
 * production build. Three mechanisms keep it that way and each is asserted
 * here, because none of them is visible to the type system:
 *
 *   1. the branch in `app/root.tsx` compares `import.meta.env.MODE` against
 *      **source literals**, which is what lets esbuild fold it and Rollup drop
 *      it (a constant would defeat the fold);
 *   2. the import behind that branch is **dynamic**, so production does not
 *      merely drop an assignment — it never pulls `app/db`, Dexie or hash-wasm
 *      into the graph;
 *   3. `vite.config.ts` reads the emitted client chunks back and fails the
 *      build in both directions.
 *
 * The runtime half of (3) — that a production build really is clean — is the
 * guard itself, which runs on every `npm run build`. What is checked here is
 * that the guard is still *pointed at this handle*.
 */

const read = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');

/**
 * The build-time condition, written out exactly as it must appear in source —
 * the same two clauses `test/unit/auth-emulator.test.ts` pins for the session
 * handle. Not built from a constant: the point is that the literal is spelled
 * out at the branch site.
 */
const MODE_GUARD = [
  "import.meta.env.MODE === 'development'",
  "import.meta.env.MODE === 'emulator'",
];

describe('the handle name', () => {
  it('is namespaced and distinct from the session handle', () => {
    expect(DB_TEST_HANDLE.startsWith('__cifra')).toBe(true);
    expect(DB_TEST_HANDLE).not.toBe(SESSION_TEST_HANDLE);
  });
});

describe('the branch in app/root.tsx is written so the bundler can delete it', () => {
  const root = read('app/root.tsx');

  it.each(MODE_GUARD)('tests `%s` as a source literal', (clause) => {
    expect(root).toContain(clause);
  });

  it('imports the seam dynamically, so the db layer stays out of production', () => {
    // A static import would ship Dexie, hash-wasm and the whole db layer to
    // real users for the sake of a branch that can never run.
    expect(root).toContain("import('./db/db-test-api')");
    expect(root).not.toMatch(/^import .*db-test-api/m);
  });

  it('installs the handle from exactly one site', () => {
    // More than one call site means more than one branch to keep foldable, and
    // the bundle guard only proves the *result*, not that every site was gated.
    expect(root.match(/import\('\.\/db\/db-test-api'\)/g)).toHaveLength(1);
  });
});

describe('the production-bundle guard covers this handle too', () => {
  const config = read('vite.config.ts');

  it('imports the token from the app rather than retyping it', () => {
    expect(config).toContain(
      "import { DB_TEST_HANDLE } from './app/db/db-test-handle.ts'",
    );
    expect(config).toContain('DB_TEST_HANDLE,');
  });
});

describe('the seam obeys the layer contract', () => {
  it('db-test-handle.ts imports nothing — vite.config.ts reads it', () => {
    // Same reasoning as `auth-emulator.ts` and `session-test-handle.ts`: Vite's
    // native config loader warns about every extensionless specifier reachable
    // from the config, transitive ones included.
    const graph = repoImportGraph('app/db/db-test-handle.ts');
    expect([...graph.files]).toEqual(['app/db/db-test-handle.ts']);
    expect(graph.packages.size).toBe(0);
  });

  it('db-test-api.ts reaches the real database and the real key hierarchy', () => {
    // The positive control. If this fails, the seam is handing the browser spec
    // something other than the shipping code and every assertion the spec makes
    // is about a stand-in.
    const graph = repoImportGraph('app/db/db-test-api.ts');
    expect(graph.files).toContain('app/db/database.ts');
    expect(graph.files).toContain('app/db/encryption-middleware.ts');
    expect(graph.files).toContain('app/crypto/kdf.ts');
    expect(graph.files).toContain('app/crypto/key-wrap.ts');
    expect(packagesMatching(graph, 'dexie')).toEqual(['dexie']);
  });

  it('db-test-api.ts reaches no UI framework and no Firebase SDK', () => {
    const graph = repoImportGraph('app/db/db-test-api.ts');
    expect(
      packagesMatching(graph, 'react', 'react-dom', 'react-router'),
    ).toEqual([]);
    expect(packagesMatching(graph, 'firebase', '@firebase')).toEqual([]);
    expect(filesUnder(graph, 'app/stores/', 'app/services/')).toEqual([]);
  });
});

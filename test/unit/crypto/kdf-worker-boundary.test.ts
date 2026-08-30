/**
 * **Argon2id must not run on the main thread.** (#61, D22)
 *
 * The other suites assert what derivation *produces*. This one asserts where it
 * *happens*, and it is the only assertion that survives a refactor: a test that
 * measured responsiveness in Node would measure nothing, and a reviewer
 * noticing an `import { argon2id }` is exactly the enforcement CLAUDE.md's layer
 * contract says is not enough.
 *
 * The mechanism is the AST import walker in `test/support/import-graph.ts`.
 * `new URL('./kdf-worker.ts', import.meta.url)` is a `module-url` reference —
 * a bundler-resolved *worker entry*, not an import, so what sits behind it runs
 * on another thread in another realm. Walking `app/crypto/kdf.ts` with that one
 * kind of edge excluded therefore answers precisely the question this issue is
 * about: **what can the main thread reach?** If an Argon2id implementation ever
 * appears in that answer, derivation has moved back onto the UI thread and this
 * fails.
 *
 * Every assertion here is paired with a positive control, because a graph
 * question can be answered "nothing" for two very different reasons.
 */

import { describe, expect, it } from 'vitest';

import {
  filesUnder,
  packagesMatching,
  referenceKindsExcept,
} from '../../support/import-graph';
import { repoImportGraph } from '../../support/repo-graph';

/** Anything that could compute an Argon2id digest. */
const HASHING_PACKAGES = ['hash-wasm', 'argon2-browser', '@node-rs/argon2'];

/** The main thread's view: every edge except the worker URL. */
const MAIN_THREAD_ONLY = { followKinds: referenceKindsExcept('module-url') };

describe('the walker can see the worker, so its silence means something', () => {
  it('reaches the worker body and hash-wasm when it follows every edge', () => {
    const graph = repoImportGraph('app/crypto/kdf.ts');
    expect(graph.files).toContain('app/crypto/kdf-worker.ts');
    expect(graph.files).toContain('app/crypto/kdf-worker-body.ts');
    expect(packagesMatching(graph, ...HASHING_PACKAGES)).toEqual(['hash-wasm']);
  });

  it('records the worker URL as exactly one module-url reference', () => {
    const graph = repoImportGraph('app/crypto/kdf.ts');
    const workerUrls = [...graph.references.entries()].flatMap(
      ([file, references]) =>
        references
          .filter((reference) => reference.kind === 'module-url')
          .map((reference) => `${file} -> ${reference.specifier}`),
    );
    expect(workerUrls).toEqual([
      'app/crypto/kdf-worker-client.ts -> ./kdf-worker.ts',
    ]);
  });

  it('still reaches hash-wasm from the worker entry with the URL edge excluded', () => {
    // The control that makes the assertions below non-vacuous: excluding
    // `module-url` does not blind the walker in general, it only stops it at
    // that one seam. From inside the worker, hash-wasm is still right there.
    const graph = repoImportGraph('app/crypto/kdf-worker.ts', MAIN_THREAD_ONLY);
    expect(packagesMatching(graph, ...HASHING_PACKAGES)).toEqual(['hash-wasm']);
  });
});

describe('the main thread reaches no Argon2id implementation', () => {
  it.each([
    'app/crypto/kdf.ts',
    'app/crypto/kdf-worker-client.ts',
    'app/crypto/kdf-params.ts',
  ])('%s cannot reach one without crossing the worker boundary', (entry) => {
    const graph = repoImportGraph(entry, MAIN_THREAD_ONLY);
    expect(packagesMatching(graph, ...HASHING_PACKAGES)).toEqual([]);
  });

  it('cannot reach the worker body either, by any other route', () => {
    // Stronger than "no hash-wasm": it also fails if someone re-exports
    // `handleDeriveRequest` or the digest helper onto the main thread and calls
    // it there, which would be main-thread derivation without a new dependency.
    const graph = repoImportGraph('app/crypto/kdf.ts', MAIN_THREAD_ONLY);
    expect(filesUnder(graph, 'app/crypto/kdf-worker-body')).toEqual([]);
  });

  it('holds for the whole app, not just the crypto layer', () => {
    // `app/db/db-test-api.ts` is today's only caller of `deriveMasterKey`. If
    // hash-wasm became reachable from the page's own graph, the worker would be
    // an extra thread rather than the place derivation happens.
    const graph = repoImportGraph('app/db/db-test-api.ts', MAIN_THREAD_ONLY);
    expect(packagesMatching(graph, ...HASHING_PACKAGES)).toEqual([]);
  });
});

describe('the worker chunk stays inside the crypto layer', () => {
  it.each(['app/crypto/kdf-worker.ts', 'app/crypto/kdf-worker-body.ts'])(
    '%s imports no Dexie, no React and nothing from app/db',
    (entry) => {
      const graph = repoImportGraph(entry);
      expect(
        packagesMatching(
          graph,
          'dexie',
          'react',
          'react-dom',
          'react-router',
          'firebase',
        ),
      ).toEqual([]);
      expect(
        filesUnder(graph, 'app/db/', 'app/routes/', 'app/stores/'),
      ).toEqual([]);
    },
  );
});

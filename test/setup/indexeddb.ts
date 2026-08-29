/**
 * Provides an in-memory IndexedDB to the unit suites.
 *
 * `docs/architecture.md` §Testing: "The db layer runs on `fake-indexeddb`".
 *
 * This has to be a Vitest **setup file** rather than an import inside a test:
 * Dexie captures `globalThis.indexedDB` when its module is first evaluated, and
 * ES module imports are hoisted, so any test file that imports `dexie` directly
 * would evaluate it before an in-file `import 'fake-indexeddb/auto'` had run.
 * A setup file runs before the test module graph is loaded at all.
 *
 * Suites that never open a database are unaffected — this only defines globals
 * the browser would have provided anyway.
 */

import 'fake-indexeddb/auto';

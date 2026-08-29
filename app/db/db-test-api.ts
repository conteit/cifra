/**
 * The db-layer test seam: the vault key hierarchy and the encrypted database,
 * reachable from page context so a Playwright spec can drive them.
 *
 * Read `db-test-handle.ts` first — it carries the *why*, the build-time gate,
 * and the expected lifetime of this module. This file is only the surface.
 *
 * ## What is exposed, and what deliberately is not
 *
 * Exactly the constructors and functions that have to be *invoked inside the
 * page*, because they need real Web Crypto and real IndexedDB:
 *
 *   · steps 2–3 of the key hierarchy — `generateSalt`, `deriveMasterKey`,
 *     `createWrappedDataKey`, `unwrapDataKey` (`docs/architecture.md` §Crypto);
 *   · the session key holder and the database itself.
 *
 * Nothing else. Pure constants the spec needs (`ENCRYPTED_BLOB_FIELD`,
 * `MIN_ENVELOPE_LENGTH_BYTES`, the row types) are imported by the spec directly
 * from the app's own modules in Node — they need no browser — so they are not
 * duplicated onto a runtime object where they could drift.
 *
 * There is no scenario runner here, and that is deliberate: the *test* belongs
 * in `test/e2e/db-liveness.spec.ts`, not in `app/`. This module hands the page
 * the same objects `app/db/database.ts` would use in production and nothing
 * more, so what the spec exercises is the shipping middleware rather than a
 * test-shaped imitation of it.
 *
 * `CifraDatabase` is constructed with an explicit name and an explicit
 * `VaultKeyHolder` — the two parameters that exist so tests can hold one
 * database and one vault per case — rather than through `getDatabase()`, whose
 * process-wide singleton would make cases order-dependent.
 *
 * Per the layer contract this imports crypto and Dexie-backed db modules, never
 * React; `test/unit/db/layer-boundary.test.ts` enumerates `app/db/*.ts` and
 * holds this file to that automatically.
 */

import {
  ARGON2ID_DEFAULT_PARAMS,
  deriveMasterKey,
  generateSalt,
} from '../crypto/kdf';
import { createWrappedDataKey, unwrapDataKey } from '../crypto/key-wrap';
import { CifraDatabase } from './database';
import { DB_TEST_HANDLE } from './db-test-handle';
import { VaultKeyHolder } from './vault-key';

/** The shape assigned to `window[DB_TEST_HANDLE]`. */
export interface DbTestApi {
  readonly ARGON2ID_DEFAULT_PARAMS: typeof ARGON2ID_DEFAULT_PARAMS;
  readonly generateSalt: typeof generateSalt;
  readonly deriveMasterKey: typeof deriveMasterKey;
  readonly createWrappedDataKey: typeof createWrappedDataKey;
  readonly unwrapDataKey: typeof unwrapDataKey;
  readonly VaultKeyHolder: typeof VaultKeyHolder;
  readonly CifraDatabase: typeof CifraDatabase;
}

const api: DbTestApi = {
  ARGON2ID_DEFAULT_PARAMS,
  generateSalt,
  deriveMasterKey,
  createWrappedDataKey,
  unwrapDataKey,
  VaultKeyHolder,
  CifraDatabase,
};

/**
 * Publishes the seam.
 *
 * Called only from the folded branch in `app/root.tsx`; importing this module
 * has no side effect of its own, so a stray import cannot install the handle by
 * accident.
 */
export function installDbTestHandle(): DbTestApi {
  (globalThis as unknown as Record<string, unknown>)[DB_TEST_HANDLE] = api;
  return api;
}

/**
 * The `meta` row that holds the vault.
 *
 * `docs/architecture.md` §Crypto key hierarchy step 3: the wrapped data key,
 * the salts and the Argon2id parameters live in a plaintext `meta` table, and
 * since D26 there are **two** wrapped copies of the same data key in it. This
 * module is the whole of that persistence — read one row, write one row — and
 * nothing else in the app touches `meta`.
 *
 * ## One row, not six fields spread across rows
 *
 * `app/crypto/vault.ts` returns a `VaultRecord` whose parts only make sense
 * together: a password copy stored beside a stale salt, or a recovery copy
 * written a moment after a password copy from a different call, is an
 * unopenable vault. IndexedDB gives per-*record* atomicity for free, so the
 * whole record goes into a single row under a single key and the failure mode
 * disappears rather than being coordinated around.
 *
 * ## Untrusted on read
 *
 * The row is plaintext and, until #32, unauthenticated. `readVaultRecord`
 * therefore returns whatever it found **unvalidated**, typed as `unknown`, and
 * leaves validation to `assertVaultRecord` / `unlockVault` in the crypto layer
 * — one gate, on the path where the bytes are actually about to be used, rather
 * than a second, drifting copy of D19's bounds here.
 *
 * Per the layer contract this imports Dexie and the crypto layer's *types*,
 * and never React.
 */

import type { VaultRecord } from '../crypto/vault';
import type { CifraDatabase } from './database';
import type { MetaRow } from './schema';

/**
 * The `meta` primary key the vault record lives under.
 *
 * A constant, not a literal at each call site: `meta` is an open-ended table
 * (`MetaRow` is `{ key: string; [field: string]: unknown }`), so a typo would
 * silently create a second row and report the vault as absent.
 */
export const VAULT_META_KEY = 'vault';

/** The `meta` row shape. `key` is Dexie's primary key; the rest is the record. */
export type VaultMetaRow = MetaRow & VaultRecord;

/**
 * Reads the vault row, or `undefined` when this device holds no vault yet.
 *
 * `undefined` is the *setup* signal — it is what routes a first run to the
 * vault-setup screen — so it must mean "no row", never "a row we could not
 * understand". A malformed row therefore comes back as-is and fails loudly at
 * `assertVaultRecord`, rather than being rounded down to "no vault" and
 * offering to create a second one over the top of the first.
 */
export async function readVaultRecord(
  db: CifraDatabase,
): Promise<unknown | undefined> {
  return await db.meta.get(VAULT_META_KEY);
}

/**
 * Writes the vault record as one row.
 *
 * `put`, so re-writing after a password change or a phrase rotation replaces
 * the row whole. There is no partial-update path on purpose: every operation in
 * `app/crypto/vault.ts` returns a complete record precisely so that persisting
 * one is a single replacement.
 */
export async function writeVaultRecord(
  db: CifraDatabase,
  record: VaultRecord,
): Promise<void> {
  const row: VaultMetaRow = { key: VAULT_META_KEY, ...record };
  await db.meta.put(row);
}

/**
 * The Cifra IndexedDB database.
 *
 * One Dexie subclass, one schema version, one middleware. The stores
 * declaration is generated from the table allowlist (`schema.ts`) so the set of
 * indexes and the set of plaintext fields are the same statement written once.
 *
 * `docs/architecture.md` §Stack and layering:
 * `pages → stores → services → db (Dexie 4 + middleware) → crypto (Web Crypto)`.
 * This module is the top of the db layer. It imports crypto through the
 * middleware and never imports React.
 */

import Dexie, { type Table } from 'dexie';
import { createEncryptionMiddleware } from './encryption-middleware';
import {
  type CategoryRow,
  DATABASE_NAME,
  type MetaRow,
  SCHEMA_VERSION,
  storesDeclaration,
  TABLE_ALLOWLIST,
  type TransactionRow,
} from './schema';
import { vaultKey, type VaultKeyHolder } from './vault-key';

export class CifraDatabase extends Dexie {
  // `declare` rather than a field declaration: with `useDefineForClassFields`
  // (implied by an ES2022 target) a declared-but-uninitialised field is defined
  // as `undefined` at construction and would overwrite the table objects Dexie
  // assigns. `declare` emits nothing.
  declare readonly meta: Table<MetaRow, string>;
  declare readonly transactions: Table<TransactionRow, string>;
  declare readonly categories: Table<CategoryRow, string>;

  /**
   * @param name IndexedDB database name. Overridden only by tests, which need
   * one database per case.
   * @param keys the session data-key holder. Defaults to the module-scoped
   * singleton §Session lifetime calls for; tests pass their own so cases do not
   * share a vault.
   */
  constructor(name: string = DATABASE_NAME, keys: VaultKeyHolder = vaultKey) {
    super(name);
    // Registered before `version()` so it is in place for the very first
    // transaction, including anything an upgrade handler writes.
    this.use(
      createEncryptionMiddleware({
        allowlist: TABLE_ALLOWLIST,
        vaultKey: keys,
      }),
    );
    this.version(SCHEMA_VERSION).stores(storesDeclaration(TABLE_ALLOWLIST));
  }
}

let instance: CifraDatabase | undefined;

/**
 * The application's database handle.
 *
 * Lazy so that importing this module has no side effect — `new Dexie(...)`
 * touches `indexedDB`, which must not happen during a Storybook or test import
 * that never opens a database.
 */
export function getDatabase(): CifraDatabase {
  instance ??= new CifraDatabase();
  return instance;
}

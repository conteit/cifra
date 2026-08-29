/**
 * The Dexie 4 DBCore encryption middleware.
 *
 * `docs/architecture.md` §Encryption middleware:
 *
 * > `app/db/encryption-middleware.ts` is a Dexie 4 DBCore middleware. It
 * > intercepts `mutate` to encrypt before writes, and `get` / `getMany` /
 * > `query` to decrypt after reads. DBCore is promise-based, so async Web
 * > Crypto works natively — the constraint that forced synchronous TweetNaCl in
 * > v1 no longer applies.
 *
 * DBCore rather than Dexie hooks is the whole point: hooks (`creating`,
 * `reading`, `updating`) are synchronous, which is what forced v1 to a
 * synchronous cipher. DBCore is the promise-based layer directly above
 * IndexedDB, so `await subtle.encrypt(...)` sits in the request path with no
 * contortion, and there is exactly one seam every read and write must cross.
 *
 * ## Position in the stack
 *
 * Registered at Dexie's default level (10), which makes it the **outermost**
 * middleware: Dexie composes `middlewares.reduce((down, mw) => mw.create(down))`
 * over a list sorted by ascending level, so the highest level wraps everything
 * else. Every middleware below — hooks (2), virtual indexes (1), the live-query
 * cache (0), observability (0), existing-value caching (−1) — therefore sees
 * ciphertext only. Plaintext exists above this line and nowhere below it.
 *
 * ## What each intercepted method does
 *
 * - `mutate` / `add` + `put` — every value is re-shaped into
 *   `{ …plaintext indexed fields, __enc: <envelope> }` before it goes down. The
 *   caller's object is never mutated; a new object is built.
 * - `mutate` / `delete` — nothing to encrypt. Keys are plaintext, so the
 *   request passes straight through.
 * - `mutate` / `deleteRange` — a range over an index. Encrypted fields are
 *   never indexed (enforced at open time), so a range can only ever address
 *   plaintext keys and the request passes through unchanged.
 * - `get` / `getMany` — decrypt each returned row; missing rows stay
 *   `undefined`.
 * - `query` — decrypt **only when `req.values` is truthy**. A keys-only query
 *   (`values: false`, which is what `Collection.primaryKeys()` and
 *   `Collection.modify()` issue) returns primary keys, and attempting to
 *   decrypt a key would be a silent-corruption bug. The check mirrors the base
 *   DBCore's own `values ? getAll : getAllKeys` branch exactly.
 * - `count` — no values are involved, but it is still gated on an unlocked
 *   vault so that "locked" means the table is unreachable rather than
 *   half-readable.
 * - `openCursor` — **rejected** for value-bearing cursors on encrypted tables;
 *   see below.
 *
 * ## Authenticated plaintext columns
 *
 * A row's plaintext-indexed columns are not encrypted — IndexedDB has to
 * range-query them — but the ones the allowlist marks `{ aad: 'bound' }` are
 * **authenticated**: their values go into the AES-GCM AAD alongside the table
 * and the record id. `encryptValue` reads them from the value being written and
 * `decryptValue` rebuilds them from the row as stored, so a `date` or `type`
 * rewritten directly in the database yields a different AAD and the read fails
 * with `record/corrupt` (#51).
 *
 * A consequence worth stating: changing a bound column means re-encrypting the
 * record, not just re-indexing it. That comes free here because every write is
 * a whole-value `put` — `Table.update()` and `Collection.modify()` read, modify
 * and write the full value — so the encrypted blob is always re-emitted from
 * the same object the new column value came from. Exactly the property the
 * primary-key-change path already relied on.
 *
 * ## Why `openCursor` fails closed
 *
 * A `DBCoreCursor` exposes `value` as a *synchronous* property that Dexie reads
 * inside `cursor.start(onNext)`. Decryption is asynchronous, so there is no
 * honest way to hand back a decrypting cursor without buffering the entire
 * range in memory first and re-implementing the cursor protocol
 * (`continue` / `continuePrimaryKey` / `advance` / `stop` / `fail`) on top of
 * it. Returning the raw cursor instead would hand callers ciphertext that looks
 * like a record — the worst outcome available. So a value cursor on an
 * encrypted table raises `read/cursor-unsupported`.
 *
 * In practice that rules out `Collection.each()`, `.filter()`, `.offset()`,
 * `.and()` and `.or()` on encrypted tables. Everything else keeps working:
 * `Table.get`, `bulkGet`, `toArray`, `orderBy(...).toArray`, `where(...)
 * .between(...).toArray()`, `count`, `primaryKeys`, `put`, `add`, `bulkPut`,
 * `delete`, `clear`, `update` and `modify` all route through `get` / `getMany`
 * / `query` / `mutate`. Filtering on decrypted content has to happen in a
 * service after reading anyway — the data is not indexable — so the restriction
 * pushes callers towards the only design that was ever going to work. Issue #41
 * tracks revisiting it.
 *
 * ## Locked state
 *
 * Every intercepted method calls `vaultKey.require()` before anything else, so
 * a locked vault produces `DbEncryptionError` `vault/locked` — never an opaque
 * Web Crypto failure, and never ciphertext. Plaintext tables (`meta`) are not
 * wrapped at all, which is what lets the unlock flow read the wrapped data key
 * and the KDF salt before a key exists.
 */

import type {
  DBCore,
  DBCoreCountRequest,
  DBCoreGetManyRequest,
  DBCoreGetRequest,
  DBCoreIndex,
  DBCoreMutateRequest,
  DBCoreMutateResponse,
  DBCoreOpenCursorRequest,
  DBCoreQueryRequest,
  DBCoreQueryResponse,
  DBCoreTable,
  Middleware,
} from 'dexie';
import Dexie from 'dexie';
import {
  decryptRecord,
  encryptRecord,
  RecordCipherError,
} from '../crypto/record-cipher';
import { DbEncryptionError } from './db-error';
import {
  aadBoundFields,
  assertKnownFields,
  decodeSensitiveFields,
  encodeSensitiveFields,
  plaintextProjection,
} from './record-serialization';
import {
  assertValidAllowlist,
  ENCRYPTED_BLOB_FIELD,
  type EncryptedTableSpec,
  requireTableSpec,
  type TableAllowlist,
} from './schema';
import type { VaultKeyHolder } from './vault-key';

export interface EncryptionMiddlewareOptions {
  /** The security contract. Validated eagerly; a contradiction throws here. */
  readonly allowlist: TableAllowlist;
  /** Session data-key holder (§Session lifetime). */
  readonly vaultKey: VaultKeyHolder;
}

/** Dexie middleware level. 10 is Dexie's default and the outermost position. */
export const ENCRYPTION_MIDDLEWARE_LEVEL = 10;

export const ENCRYPTION_MIDDLEWARE_NAME = 'CifraEncryptionMiddleware';

/**
 * Awaits Web Crypto without letting the surrounding IndexedDB transaction
 * commit underneath it.
 *
 * This is the one place where "DBCore is promise-based, so async Web Crypto
 * works natively" needs a footnote. An IndexedDB transaction is only *active*
 * during the task that created it and during its own request callbacks; the
 * moment control returns to the event loop with no request outstanding, the
 * transaction commits. `crypto.subtle.encrypt` resolves in a later task, so a
 * bare `await` in the middle of a Dexie transaction lets the transaction close
 * and the next operation fails with `InvalidStateError`. It is not a
 * `fake-indexeddb` quirk — browsers behave the same way, and it is exactly the
 * hazard that pushed v1 to a synchronous cipher.
 *
 * `Dexie.waitFor` is Dexie's answer: while the promise is pending it keeps
 * issuing a dummy `get` against the transaction, so the transaction stays
 * active and the continuation resumes inside a request callback. Outside a
 * transaction it is a passthrough, so the wrapper is safe everywhere.
 *
 * The async cipher is still the win the architecture claims — Argon2id, AES-GCM
 * and a non-extractable `CryptoKey` are all unreachable synchronously. It just
 * needs this one adapter to coexist with IndexedDB's transaction model.
 *
 * The unit suites prove this against `fake-indexeddb`, whose scheduler is not a
 * browser's. Issue #42 tracks demonstrating the same round-trip against a real
 * engine once there is a UI path that writes a record.
 */
function keepTransactionAlive<T>(work: Promise<T>): Promise<T> {
  return Dexie.waitFor(work);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !ArrayBuffer.isView(value)
  );
}

/** Every field name an index keyPath addresses, compound indexes included. */
function keyPathFields(index: DBCoreIndex): string[] {
  const { keyPath } = index;
  if (keyPath === null) return [];
  return Array.isArray(keyPath) ? [...keyPath] : [keyPath];
}

/**
 * Verifies the *opened* schema against the allowlist, at db-open time.
 *
 * The stores string is already derived from the allowlist (see
 * `schema.ts`), so this is belt and braces — but it is the only check that
 * looks at what IndexedDB actually built, and the failure it guards against
 * (an encrypted field carrying an index, and therefore a plaintext copy of
 * itself) is exactly the leak this whole layer exists to prevent. It runs
 * inside `create()`, so a violation fails `db.open()` loudly rather than
 * surfacing as a quiet leak at runtime.
 */
function assertSchemaMatchesAllowlist(
  down: DBCore,
  allowlist: TableAllowlist,
): void {
  for (const tableSchema of down.schema.tables) {
    const table = tableSchema.name;
    const spec = requireTableSpec(allowlist, table);
    const schema = down.table(table).schema;

    if (schema.primaryKey.keyPath !== spec.primaryKey) {
      throw new DbEncryptionError(
        'schema/invalid-primary-key',
        `Table '${table}' has primary key '${String(schema.primaryKey.keyPath)}' but the allowlist declares '${spec.primaryKey}'`,
      );
    }

    const plaintextFields = new Set([spec.primaryKey, ...spec.indexes]);
    const indexedKeyPaths = new Set(
      schema.indexes.flatMap((index) => keyPathFields(index)),
    );

    for (const declared of spec.indexes) {
      if (!indexedKeyPaths.has(declared)) {
        throw new DbEncryptionError(
          'schema/index-conflict',
          `Table '${table}' declares plaintext index '${declared}' but the opened schema has no such index`,
        );
      }
    }
    // The security direction: nothing is indexed that the allowlist has not
    // blessed as plaintext. Because an index stores its key in the clear, an
    // index over an encrypted field would be a verbatim plaintext copy.
    for (const indexed of indexedKeyPaths) {
      if (!plaintextFields.has(indexed)) {
        throw new DbEncryptionError(
          'schema/index-conflict',
          `Table '${table}' indexes '${indexed}', which the allowlist does not declare as plaintext`,
        );
      }
    }

    if (spec.kind !== 'encrypted') continue;

    // The AAD contract from #5: the record id must be a string that exists
    // before the write, so an auto-incremented or outbound key is impossible.
    if (schema.primaryKey.autoIncrement) {
      throw new DbEncryptionError(
        'schema/invalid-primary-key',
        `Encrypted table '${table}' must not use an auto-incrementing primary key: the id is bound into the ciphertext and must exist before the write`,
      );
    }
    if (schema.primaryKey.outbound) {
      throw new DbEncryptionError(
        'schema/invalid-primary-key',
        `Encrypted table '${table}' must use an inbound primary key so the id travels with the record`,
      );
    }
  }
}

/**
 * Reads the record id out of a value, enforcing the string-key contract.
 *
 * @throws {DbEncryptionError} `record/invalid-primary-key`.
 */
function requireRecordId(
  table: string,
  spec: EncryptedTableSpec,
  value: Record<string, unknown>,
  explicitKey: unknown,
): string {
  const recordId = value[spec.primaryKey];
  if (typeof recordId !== 'string' || recordId.length === 0) {
    throw new DbEncryptionError(
      'record/invalid-primary-key',
      `Record for table '${table}' must carry a non-empty string '${spec.primaryKey}'; ids are client-generated and bound into the ciphertext`,
    );
  }
  if (explicitKey !== undefined && explicitKey !== recordId) {
    throw new DbEncryptionError(
      'record/invalid-primary-key',
      `Record for table '${table}' was written under a key that differs from its '${spec.primaryKey}' field`,
    );
  }
  return recordId;
}

/**
 * `{ …record }` → `{ …plaintext indexed fields, __enc: envelope }`.
 *
 * A brand-new object is returned: mutating the caller's value would strip the
 * amount and description out of an object the application still holds.
 */
async function encryptValue(
  table: string,
  spec: EncryptedTableSpec,
  dataKey: CryptoKey,
  value: unknown,
  explicitKey: unknown,
): Promise<Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    throw new DbEncryptionError(
      'record/invalid-value',
      `Records written to table '${table}' must be plain objects`,
    );
  }
  assertKnownFields(table, spec, value);
  const recordId = requireRecordId(table, spec, value, explicitKey);

  // Read from the value being written, so a `date` or `type` that changed is
  // sealed with its new value. Every write is a full re-encryption — Dexie's
  // update()/modify() read-modify-write into a whole-value put — so a bound
  // column can never be re-indexed without the ciphertext following it.
  const boundFields = aadBoundFields(table, spec, value);

  const plaintext = encodeSensitiveFields(table, spec, value);
  try {
    const envelope = await encryptRecord(dataKey, plaintext, {
      table,
      recordId,
      boundFields,
    });
    return {
      ...plaintextProjection(spec, value),
      [ENCRYPTED_BLOB_FIELD]: envelope,
    };
  } finally {
    // Best-effort hygiene, matching the crypto layer: drop the serialized
    // plaintext as soon as it has been sealed rather than leaving it in a live
    // buffer. JavaScript offers no guarantee here — the source strings are
    // immutable and the GC may have copied them — so this narrows the window,
    // it does not close it.
    plaintext.fill(0);
  }
}

/**
 * `{ …plaintext, __enc }` → `{ …record }`.
 *
 * A failed authentication is **corruption**, surfaced as `record/corrupt` with
 * the underlying `RecordCipherError` as `cause`. It is never swallowed and a
 * partial record is never returned: per #5, `decrypt/failed` covers a moved
 * blob, a tampered row and a wrong key alike, and none of them may reach a
 * balance.
 */
async function decryptValue(
  table: string,
  spec: EncryptedTableSpec,
  dataKey: CryptoKey,
  stored: unknown,
): Promise<unknown> {
  if (stored === undefined || stored === null) return stored;
  if (!isPlainRecord(stored)) {
    throw new DbEncryptionError(
      'record/corrupt',
      `Stored row in table '${table}' is not an object`,
    );
  }

  const recordId = stored[spec.primaryKey];
  if (typeof recordId !== 'string' || recordId.length === 0) {
    throw new DbEncryptionError(
      'record/corrupt',
      `Stored row in table '${table}' has no string '${spec.primaryKey}'`,
    );
  }
  const envelope = stored[ENCRYPTED_BLOB_FIELD];
  if (!(envelope instanceof Uint8Array)) {
    throw new DbEncryptionError(
      'record/corrupt',
      `Stored row '${recordId}' in table '${table}' has no encrypted payload`,
    );
  }

  // Rebuilt from the row as it sits in the database. A `date` or `type` edited
  // behind the middleware's back therefore produces a different AAD than the
  // one the record was sealed with, and the tag check fails (#51).
  let boundFields: ReturnType<typeof aadBoundFields>;
  try {
    boundFields = aadBoundFields(table, spec, stored);
  } catch (cause) {
    // On the read path a bound column that is missing or the wrong type is not
    // a caller mistake — it is a damaged row, so it joins the corruption
    // taxonomy rather than reporting a write-time error code.
    throw new DbEncryptionError(
      'record/corrupt',
      `Stored row '${recordId}' in table '${table}' is missing an authenticated plaintext field`,
      cause,
    );
  }

  let payload: Uint8Array;
  try {
    payload = await decryptRecord(dataKey, envelope, {
      table,
      recordId,
      boundFields,
    });
  } catch (cause) {
    const detail = cause instanceof RecordCipherError ? ` (${cause.code})` : '';
    throw new DbEncryptionError(
      'record/corrupt',
      `Stored row '${recordId}' in table '${table}' failed authentication${detail}`,
      cause,
    );
  }

  try {
    return {
      ...plaintextProjection(spec, stored),
      ...decodeSensitiveFields(table, spec, payload),
    };
  } finally {
    payload.fill(0);
  }
}

/**
 * Builds the middleware.
 *
 * The allowlist is validated here — synchronously, when the module that owns
 * the database constructs it — so a contradiction such as a field declared both
 * indexed and encrypted fails at construction time rather than at the first
 * write.
 *
 * @throws {DbEncryptionError} `schema/invalid-allowlist` or
 * `schema/index-conflict` for a malformed allowlist.
 */
export function createEncryptionMiddleware(
  options: EncryptionMiddlewareOptions,
): Middleware<DBCore> {
  const { allowlist, vaultKey } = options;
  assertValidAllowlist(allowlist);

  return {
    stack: 'dbcore',
    name: ENCRYPTION_MIDDLEWARE_NAME,
    level: ENCRYPTION_MIDDLEWARE_LEVEL,
    create(down: DBCore): Partial<DBCore> {
      assertSchemaMatchesAllowlist(down, allowlist);

      return {
        table(name: string): DBCoreTable {
          const downTable = down.table(name);
          const spec = requireTableSpec(allowlist, name);

          // The `meta` table is plaintext by design and bypasses the middleware
          // entirely — the unlock flow has to read the wrapped data key and the
          // KDF salt out of it *before* any key exists.
          if (spec.kind !== 'encrypted') return downTable;

          const decrypt = (dataKey: CryptoKey, stored: unknown) =>
            decryptValue(name, spec, dataKey, stored);

          return {
            ...downTable,

            async mutate(
              req: DBCoreMutateRequest,
            ): Promise<DBCoreMutateResponse> {
              const dataKey = vaultKey.require();

              // `delete` carries plaintext keys and `deleteRange` a range over
              // a plaintext index (encrypted fields are never indexed), so
              // neither has anything to encrypt.
              if (req.type === 'delete' || req.type === 'deleteRange') {
                return await downTable.mutate(req);
              }

              const keys = req.keys;
              const values = await keepTransactionAlive(
                Promise.all(
                  req.values.map((value, index) =>
                    encryptValue(name, spec, dataKey, value, keys?.[index]),
                  ),
                ),
              );

              // `changeSpec` / `updates` are the per-keyPath change descriptions
              // Dexie attaches to a put for the benefit of sync addons. The base
              // DBCore ignores them, but they carry plaintext field values, so
              // they are stripped rather than passed below this line.
              const {
                changeSpec: _changeSpec,
                updates: _updates,
                ...rest
              } = req as DBCoreMutateRequest & {
                changeSpec?: unknown;
                updates?: unknown;
              };
              return await downTable.mutate({
                ...rest,
                values,
              } as DBCoreMutateRequest);
            },

            async get(req: DBCoreGetRequest): Promise<unknown> {
              const dataKey = vaultKey.require();
              const stored = await downTable.get(req);
              return await keepTransactionAlive(decrypt(dataKey, stored));
            },

            async getMany(req: DBCoreGetManyRequest): Promise<unknown[]> {
              const dataKey = vaultKey.require();
              const rows = await downTable.getMany(req);
              return await keepTransactionAlive(
                Promise.all(rows.map((row) => decrypt(dataKey, row))),
              );
            },

            async query(req: DBCoreQueryRequest): Promise<DBCoreQueryResponse> {
              const dataKey = vaultKey.require();
              const response = await downTable.query(req);
              // Keys-only: `result` holds primary keys, not records. Running
              // them through the cipher would be a silent-corruption bug.
              if (!req.values) return response;
              return {
                ...response,
                result: await keepTransactionAlive(
                  Promise.all(
                    response.result.map((row) => decrypt(dataKey, row)),
                  ),
                ),
              };
            },

            async count(req: DBCoreCountRequest): Promise<number> {
              vaultKey.require();
              return await downTable.count(req);
            },

            async openCursor(req: DBCoreOpenCursorRequest) {
              vaultKey.require();
              if (req.values) {
                throw new DbEncryptionError(
                  'read/cursor-unsupported',
                  `Table '${name}' is encrypted: a value cursor cannot decrypt (cursor.value is synchronous). Use get/getMany/toArray/where(...).toArray() instead of each()/filter()/offset().`,
                );
              }
              return await downTable.openCursor(req);
            },
          };
        },
      };
    },
  };
}

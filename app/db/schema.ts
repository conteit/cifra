/**
 * The table field allowlist — the security contract for the db layer — and the
 * Dexie schema derived from it.
 *
 * `docs/architecture.md` §Table field allowlist:
 *
 * > Encryption is per-table and allowlist-driven:
 * > - **Plaintext (indexed):** the fields IndexedDB must range-query — `id`,
 * >   `date`, `type`, and equivalent keys. These are structural, not financial
 * >   content.
 * > - **Encrypted (single blob field):** everything sensitive — `amount`,
 * >   `description`, `category`, `notes`, and any free text.
 * > - **Plaintext by design:** the `meta` table (wrapped data key, salt, KDF
 * >   params).
 *
 * ## Why the stores string is *derived*, not written
 *
 * "Indexed fields cannot be encrypted" is only true if the index list and the
 * encrypted-field list cannot drift apart. Two hand-written declarations drift;
 * one declaration cannot. {@link storesDeclaration} generates Dexie's
 * `stores()` argument from this same allowlist, so an index exists if and only
 * if the allowlist says the field is plaintext. The middleware additionally
 * re-checks the *actual* opened schema at db-open time, because a derived
 * string is still only as good as the code that consumed it.
 *
 * ## Fail closed
 *
 * A table absent from the allowlist, or a field absent from its table's entry,
 * is an error — never a silent passthrough to plaintext. A field added to a row
 * type six months from now without a matching allowlist entry fails the write
 * loudly instead of quietly leaking.
 *
 * Pure TypeScript: this module knows nothing about Dexie or Web Crypto. It is
 * the contract both of them are checked against.
 */

import { DbEncryptionError } from './db-error';

/**
 * The single field on a stored row that holds the AES-GCM envelope from
 * `encryptRecord`. Double-underscored so it reads as machinery, never as a
 * domain field, and rejected as an input field on every write.
 */
export const ENCRYPTED_BLOB_FIELD = '__enc';

/** How one sensitive field behaves. */
export interface EncryptedFieldSpec {
  /**
   * When true, a write that omits the field is rejected. Because a record's
   * sensitive fields live in one all-or-nothing blob, "omitted" cannot mean
   * "leave the stored value alone" (see §Partial updates in the middleware).
   */
  readonly required: boolean;
  /**
   * Integer cents. CLAUDE.md: "Money is integer cents. No floats, anywhere,
   * ever." Marked fields are rejected on write *and* on read-back unless
   * `Number.isSafeInteger` holds, so a float can neither enter the database nor
   * come back out of it unnoticed.
   */
  readonly cents?: boolean;
}

/** A table whose sensitive fields are encrypted into {@link ENCRYPTED_BLOB_FIELD}. */
export interface EncryptedTableSpec {
  readonly kind: 'encrypted';
  /**
   * Inbound string primary key. Client-generated and known before the write,
   * because it is bound into the ciphertext as AES-GCM AAD (contract from #5)
   * and Phase 8 sync needs device-independent ids anyway. Auto-increment is
   * therefore impossible here by construction.
   */
  readonly primaryKey: string;
  /** Secondary indexes. Every one of these is stored in plaintext. */
  readonly indexes: readonly string[];
  /** Sensitive fields, serialized together into the single blob. */
  readonly encrypted: Readonly<Record<string, EncryptedFieldSpec>>;
  /** Why each plaintext field is structural rather than financial content. */
  readonly plaintextRationale: Readonly<Record<string, string>>;
}

/** A table that is plaintext by design and bypasses the middleware entirely. */
export interface PlaintextTableSpec {
  readonly kind: 'plaintext';
  readonly primaryKey: string;
  readonly indexes: readonly string[];
  /** Why this table holds nothing that needs encrypting. */
  readonly rationale: string;
}

export type TableSpec = EncryptedTableSpec | PlaintextTableSpec;

export type TableAllowlist = Readonly<Record<string, TableSpec>>;

/**
 * The allowlist. **This table is the security contract.** Changing it changes
 * what leaves the crypto boundary, so treat an edit here as a security review.
 */
export const TABLE_ALLOWLIST = {
  /**
   * Plaintext by design (§Table field allowlist). It holds the wrapped data
   * key, the Argon2id salt, and the KDF parameters — the material needed to
   * *derive* the key, none of which is secret and all of which must be readable
   * before any key exists. Encrypting it under the key it is used to obtain is
   * circular.
   *
   * Fields are deliberately not enumerated: the guard elsewhere in this file
   * exists to stop a *sensitive* field silently landing in plaintext, and this
   * table has no sensitive fields to protect — every one of them is public
   * cryptographic parameters. Authenticating the row against substitution is
   * tracked separately as #32.
   */
  meta: {
    kind: 'plaintext',
    primaryKey: 'key',
    indexes: [],
    rationale:
      'Wrapped data key, KDF salt and Argon2id parameters. Needed before a key exists; none of it is secret.',
  },

  /**
   * The core financial record. Everything a person would recognise as their
   * spending is inside the blob.
   */
  transactions: {
    kind: 'encrypted',
    primaryKey: 'id',
    indexes: ['date', 'type'],
    encrypted: {
      amount: { required: true, cents: true },
      description: { required: true },
      category: { required: false },
      notes: { required: false },
    },
    plaintextRationale: {
      id: 'Client-generated opaque identifier. Carries no information about the transaction, and is bound into the ciphertext as AAD so a blob cannot be moved to another row.',
      date: 'Calendar day, indexed because TXNS-04 (date-sorted list) and the analytics range queries are range scans IndexedDB must perform on stored keys. Residual disclosure: an attacker with raw database access learns on which days activity happened, but not what any of it was.',
      type: "Structural mode — 'electronic' | 'cash' | 'planned' (TXNS-01..03). Indexed because CASH-01 derives the wallet balance from cash rows and the combined list filters by mode. Residual disclosure: the ratio of cash to electronic rows, but no amount, counterparty or category.",
    },
  },

  /**
   * User categories (TXNS-07). A category name is user-authored free text and
   * the §Table field allowlist names `category` as sensitive, so the name is in
   * the blob and nothing but the opaque id is indexed.
   */
  categories: {
    kind: 'encrypted',
    primaryKey: 'id',
    indexes: [],
    encrypted: {
      name: { required: true },
      icon: { required: false },
      color: { required: false },
    },
    plaintextRationale: {
      id: 'Client-generated opaque identifier, referenced by transactions. Carries no information about the category.',
    },
  },
} as const satisfies TableAllowlist;

/** Schema version passed to `Dexie.version()`. */
export const SCHEMA_VERSION = 1;

/** Default IndexedDB database name. */
export const DATABASE_NAME = 'cifra';

/**
 * Turns the allowlist into Dexie's `stores()` argument.
 *
 * Only the primary key and the declared plaintext indexes appear. The blob
 * field is never indexed — indexing ciphertext would be useless and indexing
 * anything derived from it would leak.
 */
export function storesDeclaration(
  allowlist: TableAllowlist,
): Record<string, string> {
  const stores: Record<string, string> = {};
  for (const [table, spec] of Object.entries(allowlist)) {
    stores[table] = [spec.primaryKey, ...spec.indexes].join(', ');
  }
  return stores;
}

function invalidAllowlist(message: string): DbEncryptionError {
  return new DbEncryptionError('schema/invalid-allowlist', message);
}

/**
 * Validates the allowlist against itself, at construction time.
 *
 * The contradictions caught here are the ones that would otherwise surface as a
 * silent leak much later: a field listed as both indexed and encrypted (the
 * index would store it in plaintext), a table with no encrypted fields
 * masquerading as encrypted, or a row shape that collides with the blob field.
 *
 * @throws {DbEncryptionError} `schema/invalid-allowlist` or
 * `schema/index-conflict`.
 */
export function assertValidAllowlist(allowlist: TableAllowlist): void {
  const tables = Object.entries(allowlist);
  if (tables.length === 0) {
    throw invalidAllowlist('Table allowlist must declare at least one table');
  }

  for (const [table, spec] of tables) {
    if (table.length === 0) {
      throw invalidAllowlist('Table names must be non-empty');
    }
    if (typeof spec.primaryKey !== 'string' || spec.primaryKey.length === 0) {
      throw invalidAllowlist(
        `Table '${table}' must declare a non-empty primary key path`,
      );
    }
    if (spec.primaryKey === ENCRYPTED_BLOB_FIELD) {
      throw invalidAllowlist(
        `Table '${table}' must not use '${ENCRYPTED_BLOB_FIELD}' as its primary key`,
      );
    }
    if (spec.indexes.includes(spec.primaryKey)) {
      throw invalidAllowlist(
        `Table '${table}' declares its primary key '${spec.primaryKey}' as a secondary index`,
      );
    }
    if (new Set(spec.indexes).size !== spec.indexes.length) {
      throw invalidAllowlist(`Table '${table}' declares a duplicate index`);
    }
    if (spec.indexes.includes(ENCRYPTED_BLOB_FIELD)) {
      throw new DbEncryptionError(
        'schema/index-conflict',
        `Table '${table}' indexes the encrypted blob field '${ENCRYPTED_BLOB_FIELD}'`,
      );
    }

    if (spec.kind === 'plaintext') {
      if (spec.rationale.length === 0) {
        throw invalidAllowlist(
          `Plaintext table '${table}' must state why it needs no encryption`,
        );
      }
      continue;
    }

    const encryptedFields = Object.keys(spec.encrypted);
    if (encryptedFields.length === 0) {
      throw invalidAllowlist(
        `Encrypted table '${table}' declares no encrypted fields; declare it plaintext or name its sensitive fields`,
      );
    }

    const plaintextFields = [spec.primaryKey, ...spec.indexes];
    for (const field of encryptedFields) {
      if (field === ENCRYPTED_BLOB_FIELD) {
        throw invalidAllowlist(
          `Table '${table}' names '${ENCRYPTED_BLOB_FIELD}' as an encrypted field; that name is reserved for the envelope`,
        );
      }
      // The contradiction the architecture forbids: an indexed field is stored
      // in plaintext by IndexedDB, so it cannot also be encrypted.
      if (plaintextFields.includes(field)) {
        throw new DbEncryptionError(
          'schema/index-conflict',
          `Table '${table}' declares '${field}' both plaintext-indexed and encrypted`,
        );
      }
    }

    for (const field of plaintextFields) {
      if (spec.plaintextRationale[field] === undefined) {
        throw invalidAllowlist(
          `Table '${table}' must justify plaintext field '${field}' as structural rather than financial content`,
        );
      }
    }
    for (const field of Object.keys(spec.plaintextRationale)) {
      if (!plaintextFields.includes(field)) {
        throw invalidAllowlist(
          `Table '${table}' justifies '${field}', which is not a plaintext field`,
        );
      }
    }
  }
}

/**
 * Looks a table up, failing closed.
 *
 * @throws {DbEncryptionError} `schema/unknown-table` — never a plaintext
 * passthrough. A table nobody thought about is a table nobody secured.
 */
export function requireTableSpec(
  allowlist: TableAllowlist,
  table: string,
): TableSpec {
  const spec = allowlist[table];
  if (spec === undefined) {
    throw new DbEncryptionError(
      'schema/unknown-table',
      `Table '${table}' is not in the encryption allowlist`,
    );
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

/**
 * A row of the plaintext `meta` table. Deliberately open-ended: #9 (vault
 * setup) and #32 own its exact shape, and it is not encrypted, so the
 * middleware has no stake in its fields.
 */
export interface MetaRow {
  key: string;
  [field: string]: unknown;
}

/**
 * Structural transaction mode (TXNS-01, TXNS-02, TXNS-03). Plaintext-indexed;
 * see the allowlist's `plaintextRationale`.
 */
export type TransactionType = 'electronic' | 'cash' | 'planned';

export interface TransactionRow {
  /** Client-generated opaque id. */
  id: string;
  /** ISO calendar day, `YYYY-MM-DD`. Indexed. */
  date: string;
  type: TransactionType;
  /** Integer cents; negative is an outflow (`-1234` = −12,34 €). Encrypted. */
  amount: number;
  /** Encrypted. */
  description: string;
  /** Encrypted. */
  category?: string;
  /** Encrypted. */
  notes?: string;
}

export interface CategoryRow {
  /** Client-generated opaque id. */
  id: string;
  /** Encrypted. */
  name: string;
  /** Encrypted. */
  icon?: string;
  /** Encrypted. */
  color?: string;
}

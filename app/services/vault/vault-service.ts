/**
 * The vault lifecycle, joined to storage and to the session key holder.
 *
 * `app/crypto/vault.ts` mints and opens vaults but **persists nothing**; the db
 * layer stores a row but knows nothing about keys. This module is the join, and
 * it is the only place the two meet. Governed by `docs/architecture.md` §Crypto
 * (key hierarchy steps 2–3), D19, D22 and D26.
 *
 * ## What it deliberately does not do
 *
 * It composes no primitives. `kdf.ts`, `key-wrap.ts` and `recovery-phrase.ts`
 * are never imported here: a record assembled from those in the wrong order is
 * a vault nobody can open, which is why `app/crypto/vault.ts` exposes exactly
 * one entry point per operation and why this file uses them and nothing else.
 *
 * In particular there is **no Argon2id parameter argument anywhere in this
 * module**. Creation always uses `ARGON2ID_DEFAULT_PARAMS`, chosen inside
 * `createVault`; unlocking always uses the parameters stored with the vault,
 * read inside `unlockVault`. D19's rule — "vault setup must never read
 * parameters back from `meta`" — is therefore not a convention this file
 * follows, it is a shape it cannot express: there is no variable here that
 * could hold the wrong ones.
 *
 * ## Ordering, and why it is this way round
 *
 * `create` persists the record **before** adopting the data key. A vault whose
 * key is live but whose record was never written would encrypt records under a
 * key that no password can ever reproduce — silent, total data loss the moment
 * the tab closes. The reverse failure (row written, key not adopted) costs one
 * unlock. So the expensive failure is made impossible and the cheap one is
 * allowed.
 *
 * Per the layer contract this imports crypto and the db seam, never React.
 */

import { recoveryPhrasesMatch } from '../../crypto/recovery-phrase';
import {
  type CreatedVault,
  createVault,
  isPasswordInputError,
  unlockVault,
  type VaultRecord,
} from '../../crypto/vault';
import type {
  VaultCreateOutcome,
  VaultKeySink,
  VaultOptions,
  VaultOutcome,
  VaultPresence,
  VaultRecordStore,
  VaultSecret,
  VaultService,
} from './types';

export interface VaultServiceDeps {
  readonly records: VaultRecordStore;
  readonly keys: VaultKeySink;
  /**
   * Wiring applied to every derivation — today only the worker factory, which
   * the browser-free `unit` project replaces with an in-process port. Per-call
   * options (the busy indicator's `onStateChange`) are merged over it.
   */
  readonly options?: VaultOptions;
}

export function createVaultService({
  records,
  keys,
  options: baseOptions = {},
}: VaultServiceDeps): VaultService {
  const optionsFor = (call: VaultOptions | undefined): VaultOptions => ({
    ...baseOptions,
    ...call,
  });

  return {
    get isUnlocked() {
      return keys.isUnlocked;
    },

    async probe(): Promise<VaultPresence> {
      // Presence only. A row that exists but is malformed is still a vault as
      // far as routing is concerned — it must send the user to unlock, where
      // `record/invalid` is a message they can act on, not to setup, where a
      // second vault would be created over the top of the first.
      return (await records.read()) === undefined ? 'absent' : 'present';
    },

    async create(
      password: string,
      options?: VaultOptions,
    ): Promise<VaultCreateOutcome> {
      if ((await records.read()) !== undefined) {
        return { ok: false, reason: 'vault/exists' };
      }

      let created: CreatedVault;
      try {
        created = await createVault(password, optionsFor(options));
      } catch (error) {
        // The crypto layer throws for a password it will not derive from —
        // empty or over-long — because `createVault` has no result channel.
        // Here there is one, and this is the user's mistake to fix (#91).
        if (isPasswordInputError(error)) {
          return { ok: false, reason: 'password/malformed' };
        }
        throw error;
      }
      await records.write(created.record);
      keys.unlock(created.dataKey);
      return { ok: true, recoveryPhrase: created.recoveryPhrase };
    },

    async unlock(
      secret: VaultSecret,
      options?: VaultOptions,
    ): Promise<VaultOutcome> {
      const stored = await records.read();
      if (stored === undefined) {
        // Nothing to open. Reported as an unreadable record rather than as a
        // rejected secret: telling someone their password is wrong when there
        // is no vault at all would send them hunting for a mistake they did
        // not make.
        return { ok: false, reason: 'record/invalid' };
      }

      // Cast, not validation: `unlockVault` runs `assertVaultRecord` over this
      // value before a single byte of it reaches Web Crypto, and returns
      // `record/invalid` as a result rather than throwing. Validating here as
      // well would be a second copy of D19's bounds to keep in step with the
      // first.
      const result = await unlockVault(
        stored as VaultRecord,
        secret,
        optionsFor(options),
      );
      if (!result.ok) return { ok: false, reason: result.reason };

      keys.unlock(result.dataKey);
      return { ok: true };
    },

    lock(): void {
      keys.lock();
    },

    matchRecoveryPhrase(expected: string, candidate: string): boolean {
      return recoveryPhrasesMatch(expected, candidate);
    },
  };
}

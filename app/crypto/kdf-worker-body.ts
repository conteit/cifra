/**
 * The worker-thread half of the Argon2id derivation: everything that actually
 * touches `hash-wasm`.
 *
 * Governed by `docs/architecture.md` §Crypto (Key hierarchy step 2) and D22.
 *
 * This module is the **only** place in the app that imports an Argon2id
 * implementation, and the only path to it from the main thread is the
 * `new URL('./kdf-worker.ts', import.meta.url)` reference in
 * `kdf-worker-client.ts`. `test/unit/crypto/kdf-worker-boundary.test.ts` asserts
 * that mechanically: walk `app/crypto/kdf.ts` without following that one edge
 * and `hash-wasm` must be unreachable. That is what stops derivation from
 * drifting back onto the main thread.
 *
 * It is written as a plain async function rather than as `self.onmessage`
 * plumbing so that the `unit` Vitest project can exercise it in Node with no
 * browser (CLAUDE.md: "nothing in this project may need Playwright").
 * `kdf-worker.ts` is the thin adapter that binds it to a real worker scope.
 *
 * ## The raw digest never leaves this module
 *
 * Argon2id produces 32 bytes; they are imported straight into a
 * **non-extractable** `AES-KW` `CryptoKey` and then zeroed. Only that key
 * handle is handed to the caller's `post`, and `CryptoKey` is structured-
 * cloneable, so the bytes never cross the worker boundary in any form.
 *
 * Pure TypeScript. Per the layer contract it imports neither React nor Dexie.
 */

import { argon2id } from 'hash-wasm';

import {
  type Argon2idParams,
  assertArgon2idCostBounds,
  assertDeriveInputs,
  KdfError,
  MASTER_KEY_LENGTH_BYTES,
  normalizePassword,
} from './kdf-params';
import type { KdfDeriveRequest, KdfWorkerResponse } from './kdf-worker-client';

function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new KdfError(
      'environment/no-web-crypto',
      'Web Crypto (crypto.subtle) is unavailable in this environment',
    );
  }
  return subtle;
}

/**
 * The raw Argon2id digest step, shared by {@link handleDeriveRequest} and by the
 * known-answer vector tests. Takes already-encoded bytes so that the exact
 * input fed to Argon2id is visible and testable.
 */
async function argon2idDigest(
  passwordBytes: Uint8Array,
  saltBytes: Uint8Array,
  params: Argon2idParams,
  hashLength: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await argon2id({
    password: passwordBytes,
    salt: saltBytes,
    iterations: params.iterations,
    parallelism: params.parallelism,
    memorySize: params.memorySizeKib,
    hashLength,
    outputType: 'binary',
  });
  // hash-wasm types its output as `Uint8Array<ArrayBufferLike>`, which Web
  // Crypto's `BufferSource` will not accept under TS 5.9. Copy into a view that
  // is statically known to sit on a plain `ArrayBuffer`, then clear hash-wasm's
  // copy so only one buffer holds the material.
  const out = new Uint8Array(new ArrayBuffer(digest.length));
  out.set(digest);
  digest.fill(0);
  return out;
}

/**
 * Test-only access to the raw Argon2id digest step.
 *
 * @internal Not part of the public crypto API. It exists solely so the
 * reference known-answer vectors can be asserted against the same digest
 * function {@link handleDeriveRequest} calls. Production code must use
 * `deriveMasterKey`, which never returns key material — exposing the raw digest
 * anywhere else would defeat the non-extractable `CryptoKey` guarantee. It
 * deliberately bypasses the 16-byte-salt rule because the published vectors use
 * 8-byte salts, and the strength floor because those vectors are deliberately
 * weak (m = 256 KiB, t = 1) — they pin the algorithm, not this app's policy.
 * The **cost ceiling still applies**: nothing in this codebase, test paths
 * included, gets to burn unbounded time on Argon2id.
 */
export async function argon2idDigestForVectorTests(
  passwordBytes: Uint8Array,
  saltBytes: Uint8Array,
  params: Argon2idParams,
  hashLength: number,
): Promise<Uint8Array<ArrayBuffer>> {
  assertArgon2idCostBounds(params);
  return await argon2idDigest(passwordBytes, saltBytes, params, hashLength);
}

/**
 * A worker's `onmessage` will hand over whatever the page posted, so the
 * request is parsed rather than trusted. Structural failures are the same typed
 * `KdfError` an in-thread call would have thrown, so they reach the caller as a
 * code and not as an unhandled rejection inside a worker.
 */
function assertDeriveRequest(
  request: unknown,
): asserts request is KdfDeriveRequest {
  if (
    typeof request !== 'object' ||
    request === null ||
    (request as { kind?: unknown }).kind !== 'derive'
  ) {
    throw new KdfError(
      'worker/failed',
      'The derivation worker received a message it does not understand',
    );
  }
}

/**
 * Handles one `derive` request and reports through `post`.
 *
 * The sequence is fixed:
 *
 * 1. parse the message and re-run {@link assertDeriveInputs} — the same bounds
 *    the main thread already applied. The repetition is the point: this entry
 *    point is reachable by anything that can post to the worker, and D19's cost
 *    ceiling has to hold on the side that would actually pay it;
 * 2. only then announce `deriving`, so the busy signal never lights up for a
 *    request that was rejected;
 * 3. derive, import as a non-extractable key, zero the intermediates;
 * 4. post the key — never the bytes.
 *
 * It never rejects: every failure is turned into an `error` response carrying a
 * {@link KdfError} code, because a rejected promise inside a worker is an
 * `ErrorEvent` on the other side and the main thread's typed error codes are
 * part of the contract `key-wrap.ts` and the unlock screen depend on.
 */
export async function handleDeriveRequest(
  request: unknown,
  post: (response: KdfWorkerResponse) => void,
): Promise<void> {
  let passwordBytes: Uint8Array | undefined;
  let keyBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    assertDeriveRequest(request);
    const subtle = requireSubtleCrypto();
    const { password, salt, params } = request;
    assertDeriveInputs(password, salt, params);

    post({ kind: 'deriving' });

    passwordBytes = new TextEncoder().encode(normalizePassword(password));
    keyBytes = await argon2idDigest(
      passwordBytes,
      salt,
      params,
      MASTER_KEY_LENGTH_BYTES,
    );
    const key = await subtle.importKey('raw', keyBytes, 'AES-KW', false, [
      'wrapKey',
      'unwrapKey',
    ]);
    post({ kind: 'derived', key });
  } catch (error) {
    // Nothing from the cause is forwarded. A hash-wasm or Web Crypto message
    // is not written for a user, may name internals, and is not something this
    // module can promise carries no material.
    post(
      error instanceof KdfError
        ? { kind: 'error', code: error.code, message: error.message }
        : {
            kind: 'error',
            code: 'worker/failed',
            message: 'Key derivation failed in the worker',
          },
    );
  } finally {
    // Best-effort hygiene, as on the main thread before #61 — with one thing
    // that is no longer best-effort: `deriveInWorker` terminates this worker as
    // soon as the response is delivered, so the whole heap and the Argon2
    // WebAssembly memory that held these buffers are released outright rather
    // than left for a garbage collector.
    passwordBytes?.fill(0);
    keyBytes?.fill(0);
  }
}

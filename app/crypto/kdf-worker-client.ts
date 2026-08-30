/**
 * The main-thread half of the Argon2id worker: the message contract, the port
 * abstraction, the real `Worker` factory, and the call that drives one
 * derivation from start to termination.
 *
 * Governed by `docs/architecture.md` §Crypto (Key hierarchy step 2) and D22.
 *
 * ## Why the key can cross the boundary at all
 *
 * `CryptoKey` is a [Serializable] platform object, so a **non-extractable** key
 * survives structured clone with `extractable`, `algorithm` and `usages`
 * intact, and the receiving realm can use it without ever being able to read
 * it. That was verified in both runtimes this repo targets before the design
 * was committed to (see the PR for #61): Node 24.14 `worker_threads` and
 * Chromium 151 both return a `CryptoKey` whose `extractable` is `false`, whose
 * `subtle.exportKey` rejects with `InvalidAccessError`, and which produces
 * byte-identical AES-KW output to the original.
 *
 * The consequence is that the **raw digest never leaves the worker**. Argon2id
 * runs there, `importKey` runs there, and only the opaque key handle is posted
 * back. That is strictly stronger than deriving on the main thread, where the
 * 32 raw bytes existed in the page's heap for as long as it took the garbage
 * collector to notice them.
 *
 * ## What this module may not import
 *
 * `hash-wasm`, or anything that reaches it. `test/unit/crypto/kdf-worker-boundary.test.ts`
 * walks the module graph of `kdf.ts` with the `new URL(…, import.meta.url)`
 * edge removed and fails if an Argon2id implementation is reachable — that is
 * the mechanical guard against derivation quietly moving back onto the main
 * thread. The worker's own message types are declared here, and
 * `kdf-worker-body.ts` imports them from here, so the arrow points one way.
 *
 * Pure TypeScript. Per the layer contract it imports neither React nor Dexie.
 */

import {
  type Argon2idParams,
  KdfError,
  type KdfErrorCode,
  MASTER_KEY_LENGTH_BYTES,
} from './kdf-params';

/** Algorithm the derived master key is imported for. */
const MASTER_KEY_ALGORITHM_NAME = 'AES-KW';

/** Usages the derived master key carries, and nothing else. */
const MASTER_KEY_USAGES: readonly KeyUsage[] = ['wrapKey', 'unwrapKey'];

/**
 * What the unlock UI can honestly say while a derivation is in flight.
 *
 * There is no percentage here on purpose. `hash-wasm`'s `argon2id()` takes an
 * options object and returns a promise; it exposes **no progress callback and
 * no per-pass hook** (see `node_modules/hash-wasm/dist/lib/argon2.d.ts` —
 * `IArgon2Options` is password, salt, secret, iterations, parallelism,
 * memorySize, hashLength, outputType). A percentage would therefore have to be
 * invented from a timer, which is worse than a spinner: it would be wrong on
 * exactly the slow devices where a user is watching it.
 *
 * `deriving` is nonetheless worth distinguishing from `starting`: it is posted
 * by the worker once its module graph and the Argon2 WebAssembly module have
 * loaded and the digest has actually begun, which on a cold start is the part a
 * user waits through without anything happening yet.
 */
export type KdfDerivationState = 'starting' | 'deriving' | 'settled';

/** The one request the worker understands. */
export interface KdfDeriveRequest {
  readonly kind: 'derive';
  readonly password: string;
  readonly salt: Uint8Array;
  readonly params: Argon2idParams;
}

/**
 * Everything the worker is allowed to say back.
 *
 * `derived` carries a `CryptoKey` and never bytes. `error` carries a
 * {@link KdfErrorCode} and a message the worker wrote itself, so a failure
 * arrives on the main thread as the same typed `KdfError` a local call would
 * have thrown instead of as an opaque `ErrorEvent`.
 */
export type KdfWorkerResponse =
  | { readonly kind: 'deriving' }
  | { readonly kind: 'derived'; readonly key: CryptoKey }
  | {
      readonly kind: 'error';
      readonly code: KdfErrorCode;
      readonly message: string;
    };

/**
 * The seam between {@link deriveInWorker} and an actual worker.
 *
 * It exists so the `unit` Vitest project stays browser-free: Node 24 has
 * `node:worker_threads`, not the DOM `Worker`, and CLAUDE.md requires that
 * nothing in that project need Playwright. Tests inject a port that routes
 * messages through `structuredClone` into `kdf-worker-body.ts` in-process — the
 * same message contract, the same serialization, no browser. The real `Worker`
 * is covered by `test/e2e/kdf-worker.spec.ts` in Chromium.
 */
export interface KdfWorkerPort {
  /** Sends the request. Called exactly once, after the listeners are attached. */
  post(request: KdfDeriveRequest): void;
  /** Attaches the response listener. */
  onResponse(listener: (response: KdfWorkerResponse) => void): void;
  /**
   * Attaches the listener for failures that arrive outside the message channel:
   * a worker that will not load, or a response that will not deserialize.
   */
  onFailure(listener: (reason: string) => void): void;
  /** Releases the thread and everything it holds. Must be idempotent. */
  terminate(): void;
}

export type KdfWorkerFactory = () => KdfWorkerPort;

/**
 * Builds a real dedicated module worker.
 *
 * `new URL('./kdf-worker.ts', import.meta.url)` is the bundler-resolved form:
 * Vite emits `kdf-worker.ts` and its graph as a separate chunk and rewrites the
 * URL to the emitted asset. It is also a form the AST import walker in
 * `test/support/import-graph.ts` already understands (`module-url`), which is
 * what lets the boundary test tell "reachable only through the worker" apart
 * from "reachable from the main thread".
 *
 * @throws {KdfError} `environment/no-worker` where there is no `Worker`
 * constructor — the SPA prerender pass runs this module's graph in Node, and a
 * bare `ReferenceError` there would be far less legible than a typed code.
 */
export function createBrowserKdfWorker(): KdfWorkerPort {
  if (typeof Worker === 'undefined') {
    throw new KdfError(
      'environment/no-worker',
      'Web Workers are unavailable in this environment',
    );
  }

  const worker = new Worker(new URL('./kdf-worker.ts', import.meta.url), {
    type: 'module',
  });

  return {
    post(request) {
      // Deliberately *not* transferred: the caller owns the salt and
      // `deriveMasterKey` promises not to mutate it, and a transfer would
      // detach their buffer. A 16-byte copy is not worth the surprise.
      worker.postMessage(request);
    },
    onResponse(listener) {
      worker.addEventListener('message', (event: MessageEvent) => {
        listener(event.data as KdfWorkerResponse);
      });
    },
    onFailure(listener) {
      worker.addEventListener('error', (event: ErrorEvent) => {
        listener(event.message || 'the derivation worker failed to run');
      });
      worker.addEventListener('messageerror', () => {
        listener('the derivation worker sent a message that could not be read');
      });
    },
    terminate() {
      worker.terminate();
    },
  };
}

/**
 * Rejects anything that is not exactly the master key the hierarchy expects.
 *
 * This is the check that makes "post the raw digest instead of the key" a loud
 * failure rather than a silent downgrade. A `Uint8Array`, an `ArrayBuffer`, a
 * `JsonWebKey`, an extractable key, or a key with `encrypt` in its usages all
 * fail here and never reach `key-wrap.ts`. `key-wrap.ts` asserts the same shape
 * again at its own seam; the duplication is intentional, because this one is
 * about what crossed a trust boundary and that one is about what its caller
 * handed it.
 */
function assertDerivedMasterKey(value: unknown): asserts value is CryptoKey {
  const invalid = (reason: string) =>
    new KdfError(
      'worker/failed',
      `The derivation worker returned something that ${reason}`,
    );

  if (typeof CryptoKey === 'undefined' || !(value instanceof CryptoKey)) {
    throw invalid('is not a CryptoKey');
  }
  if (value.extractable) {
    throw invalid('is an extractable key');
  }
  if (value.algorithm?.name !== MASTER_KEY_ALGORITHM_NAME) {
    throw invalid(`is not an ${MASTER_KEY_ALGORITHM_NAME} key`);
  }
  if (
    (value.algorithm as AesKeyAlgorithm).length !==
    MASTER_KEY_LENGTH_BYTES * 8
  ) {
    throw invalid(`is not ${MASTER_KEY_LENGTH_BYTES * 8} bits`);
  }
  const usages = value.usages ?? [];
  if (
    usages.length !== MASTER_KEY_USAGES.length ||
    !MASTER_KEY_USAGES.every((usage) => usages.includes(usage))
  ) {
    throw invalid(`does not carry exactly ${MASTER_KEY_USAGES.join(' and ')}`);
  }
}

function isKdfWorkerResponse(value: unknown): value is KdfWorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const { kind } = value as { kind?: unknown };
  return kind === 'deriving' || kind === 'derived' || kind === 'error';
}

/**
 * Runs one derivation on one worker and then throws the worker away.
 *
 * ## Lifecycle: one worker per derivation, terminated in `finally`
 *
 * A long-lived worker was considered and rejected. Argon2id's block array lives
 * in WebAssembly linear memory, which **grows and never shrinks** — a pooled
 * worker would hold 64 MiB after the first unlock, and up to the 256 MiB D19
 * permits after an unusual one, for the rest of the session, on a device that
 * may well be a phone. CLAUDE.md's resource-exhaustion rule and
 * §Session lifetime both point the same way: derivation happens roughly once
 * per session (unlock, and again after an idle auto-lock), so amortising a
 * spawn across it buys nothing worth 64 MiB of resident memory.
 *
 * Termination is in `finally` and therefore unconditional: success, a typed
 * error from the worker, a worker that would not load, a malformed response,
 * and a caller's `throw` all release the thread. That is also the *security*
 * reason to prefer a short-lived worker — §Session lifetime says the key lives
 * in module-scoped memory only, and terminating the worker destroys the entire
 * heap and WASM memory that held the password string, its encoded bytes and the
 * raw digest. On the main thread those merely become unreachable and wait for a
 * garbage collector.
 *
 * There is deliberately **no timeout**: the cost ceiling in `kdf-params.ts`
 * already bounds how long Argon2id can run, and a wall-clock timeout tuned on a
 * developer machine is exactly the kind of thing that fails an unlock on a slow
 * phone.
 */
export async function deriveInWorker(
  request: KdfDeriveRequest,
  createWorker: KdfWorkerFactory,
  onStateChange?: (state: KdfDerivationState) => void,
): Promise<CryptoKey> {
  onStateChange?.('starting');
  const port = createWorker();

  try {
    return await new Promise<CryptoKey>((resolve, reject) => {
      let settled = false;
      const fail = (error: KdfError) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      port.onResponse((response) => {
        if (settled) return;
        if (!isKdfWorkerResponse(response)) {
          fail(
            new KdfError(
              'worker/failed',
              'The derivation worker sent a message this client does not understand',
            ),
          );
          return;
        }
        switch (response.kind) {
          case 'deriving':
            onStateChange?.('deriving');
            return;
          case 'error':
            fail(new KdfError(response.code, response.message));
            return;
          case 'derived':
            try {
              assertDerivedMasterKey(response.key);
            } catch (error) {
              fail(
                error instanceof KdfError
                  ? error
                  : new KdfError(
                      'worker/failed',
                      'The derivation worker returned an unusable key',
                    ),
              );
              return;
            }
            settled = true;
            resolve(response.key);
            return;
        }
      });

      port.onFailure((reason) => {
        fail(new KdfError('worker/failed', reason));
      });

      port.post(request);
    });
  } finally {
    onStateChange?.('settled');
    port.terminate();
  }
}

/**
 * The Argon2id worker boundary (#61, D22).
 *
 * `kdf.test.ts` asserts what `deriveMasterKey` *computes*. This file asserts
 * what the worker boundary *is*: that only an opaque key handle crosses it,
 * that the thread is always released, that bad parameters are rejected on both
 * sides of it, and that a worker failure arrives as a typed `KdfError` rather
 * than as an `ErrorEvent`.
 *
 * ## What "in-process" does and does not prove here
 *
 * The port in `test/support/kdf-worker-port.ts` is not a mock: it runs the real
 * `handleDeriveRequest` and passes every message through `structuredClone`, the
 * same serialization `postMessage` performs. So the property this file is
 * really about — a **non-extractable `CryptoKey` survives structured clone with
 * its bytes unreadable** — is exercised for real, in the runtime `test:unit`
 * runs in. Node 24.14 and Chromium 151 were both checked before this design was
 * committed to: each returns a `CryptoKey` with `extractable === false`, an
 * `exportKey` that rejects `InvalidAccessError`, and byte-identical AES-KW
 * output to the original key.
 *
 * What it does not prove is that Vite emits the worker chunk and that a real
 * `Worker` boots it. `test/e2e/kdf-worker.spec.ts` does that in Chromium, and
 * `npm run build` is where the chunk itself is verified.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Argon2idParams,
  deriveMasterKey,
  type KdfDerivationState,
  MASTER_KEY_LENGTH_BYTES,
} from '../../../app/crypto/kdf';
import { installKdfWorkerHandler } from '../../../app/crypto/kdf-worker';
import { handleDeriveRequest } from '../../../app/crypto/kdf-worker-body';
import type { KdfWorkerResponse } from '../../../app/crypto/kdf-worker-client';
import {
  createInProcessKdfWorker,
  type RecordingKdfWorkerPort,
  recordingKdfWorkerFactory,
} from '../../support/kdf-worker-port';
import { scan } from '../../support/raw-scan';

/** The strength floor — the cheapest parameters the production gate accepts. */
const CHEAP_PARAMS: Argon2idParams = {
  memorySizeKib: 19_456,
  iterations: 2,
  parallelism: 1,
};

const SALT = new Uint8Array(16).fill(0x3c);
const PASSWORD = 'correct horse battery staple';

/** Wraps a fixed probe key, so two master keys can be compared without export. */
async function keyFingerprint(masterKey: CryptoKey): Promise<string> {
  const probe = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(32).fill(0x5a),
    'AES-GCM',
    true,
    ['encrypt'],
  );
  const wrapped = await crypto.subtle.wrapKey(
    'raw',
    probe,
    masterKey,
    'AES-KW',
  );
  return Array.from(new Uint8Array(wrapped), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

describe('the key crosses the boundary; the bytes do not', () => {
  let port: RecordingKdfWorkerPort;
  let key: CryptoKey;

  beforeEach(async () => {
    const workers = recordingKdfWorkerFactory();
    key = await deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
      createWorker: workers,
    });
    const built = workers.ports[0];
    if (built === undefined) throw new Error('no worker was created');
    port = built;
  });

  it('delivers a non-extractable AES-KW key with only wrap and unwrap usages', () => {
    expect(key.extractable).toBe(false);
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-KW');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(
      MASTER_KEY_LENGTH_BYTES * 8,
    );
    expect([...key.usages].sort()).toEqual(['unwrapKey', 'wrapKey']);
  });

  it('hands back a key the receiving realm still cannot export', async () => {
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('hands back a key that actually works after serialization', async () => {
    // The clone is only worth anything if the material came with it. A second,
    // independent derivation of the same password and salt must fingerprint
    // identically — which it can only do if both keys hold the same 32 bytes.
    const again = await deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
      createWorker: recordingKdfWorkerFactory(),
    });
    expect(await keyFingerprint(key)).toBe(await keyFingerprint(again));
  });

  /**
   * **The guarantee, stated over the wire.**
   *
   * Every message the worker side posted is flattened and searched for binary
   * data. A `CryptoKey` contributes nothing to that scan — its fields are
   * prototype getters, not own properties — so the only way a buffer appears is
   * if something posted one. The 32-byte Argon2id digest is the thing that must
   * never be there.
   */
  it('posts no byte buffer of any kind, in any message', () => {
    expect(port.responses.length).toBeGreaterThan(0);
    expect(scan(port.responses).buffers).toEqual([]);
  });

  it('posts exactly the busy signal and then the key', () => {
    expect(
      port.responses.map((response) => (response as KdfWorkerResponse).kind),
    ).toEqual(['deriving', 'derived']);
  });

  /**
   * The control for the scan above. Without it, "no buffers" would also pass if
   * `scan` could not see buffers at all — which is precisely how a guard ships
   * green against the defect it exists to catch.
   */
  it('would see the digest if a worker ever posted it (scanner control)', async () => {
    const leaky = createInProcessKdfWorker({
      handle(_request, post) {
        post({ kind: 'derived', key: new Uint8Array(32).fill(0xab) });
      },
    });
    await expect(
      deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
        createWorker: () => leaky,
      }),
    ).rejects.toMatchObject({ code: 'worker/failed' });
    expect(scan(leaky.responses).buffers).not.toEqual([]);
  });
});

describe('the client refuses anything that is not the master key', () => {
  /**
   * Each case is a response a mutated or compromised worker could send. All of
   * them must reject: the point of moving derivation off-thread is that the
   * page receives a handle it cannot read, so a response that is readable, or
   * that is over-privileged, is a failure and not a fallback.
   */
  const badResponses: ReadonlyArray<[string, () => Promise<unknown>]> = [
    ['the raw digest as bytes', async () => new Uint8Array(32).fill(1)],
    [
      'the raw digest as an ArrayBuffer',
      async () => new Uint8Array(32).fill(1).buffer,
    ],
    [
      'an extractable key',
      () =>
        crypto.subtle.importKey(
          'raw',
          new Uint8Array(32).fill(1),
          'AES-KW',
          true,
          ['wrapKey', 'unwrapKey'],
        ),
    ],
    [
      'a key that can also encrypt',
      () =>
        crypto.subtle.importKey(
          'raw',
          new Uint8Array(32).fill(1),
          'AES-GCM',
          false,
          ['encrypt', 'decrypt'],
        ),
    ],
    [
      'a 128-bit AES-KW key',
      () =>
        crypto.subtle.importKey(
          'raw',
          new Uint8Array(16).fill(1),
          'AES-KW',
          false,
          ['wrapKey', 'unwrapKey'],
        ),
    ],
    ['a plain object pretending to be a key', async () => ({ type: 'secret' })],
  ];

  it.each(badResponses)('rejects %s', async (_label, build) => {
    const value = await build();
    const port = createInProcessKdfWorker({
      handle(_request, post) {
        post({ kind: 'derived', key: value });
      },
    });
    await expect(
      deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
        createWorker: () => port,
      }),
    ).rejects.toMatchObject({ code: 'worker/failed' });
    expect(port.terminations()).toBe(1);
  });

  it('rejects a message shape it does not recognise', async () => {
    const port = createInProcessKdfWorker({
      handle(_request, post) {
        post({ kind: 'something-else' });
      },
    });
    await expect(
      deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
        createWorker: () => port,
      }),
    ).rejects.toMatchObject({ code: 'worker/failed' });
  });
});

describe('the worker is released on every path', () => {
  /**
   * The leak this catches is invisible at runtime: an un-terminated worker
   * keeps a thread and — because WebAssembly linear memory grows and never
   * shrinks — at least the 64 MiB Argon2 block array, for the life of the tab.
   * One per unlock, on a phone. `deriveInWorker` terminates in `finally`, so
   * every one of these paths must land on exactly one termination.
   */
  it('terminates after a successful derivation', async () => {
    const workers = recordingKdfWorkerFactory();
    await deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
      createWorker: workers,
    });
    expect(workers.ports).toHaveLength(1);
    expect(workers.ports[0]?.terminations()).toBe(1);
    expect(workers.ports[0]?.live()).toBe(false);
  });

  it('terminates when the worker reports a typed error', async () => {
    // An input the worker's own validation rejects. The main thread would
    // normally have caught it first, so the request is rewritten on the way in
    // to exercise the error *response* path rather than the local throw.
    const port = createInProcessKdfWorker({
      handle: (_request, post) =>
        handleDeriveRequest(
          { kind: 'derive', password: '', salt: SALT, params: CHEAP_PARAMS },
          post,
        ),
    });
    await expect(
      deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
        createWorker: () => port,
      }),
    ).rejects.toMatchObject({ code: 'password/empty' });
    expect(port.terminations()).toBe(1);
  });

  it('terminates when the worker itself fails to run', async () => {
    const port = createInProcessKdfWorker({ failWith: 'boom' });
    await expect(
      deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
        createWorker: () => port,
      }),
    ).rejects.toMatchObject({ code: 'worker/failed', message: 'boom' });
    expect(port.terminations()).toBe(1);
  });

  it('terminates when the worker answers with something unusable', async () => {
    const port = createInProcessKdfWorker({
      handle: (_request, post) => post({ kind: 'derived', key: 'not a key' }),
    });
    await expect(
      deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
        createWorker: () => port,
      }),
    ).rejects.toMatchObject({ code: 'worker/failed' });
    expect(port.terminations()).toBe(1);
  });

  it('spawns one worker per derivation and never reuses one', async () => {
    const workers = recordingKdfWorkerFactory();
    await deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
      createWorker: workers,
    });
    await deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
      createWorker: workers,
    });
    expect(workers.ports).toHaveLength(2);
    expect(workers.ports.map((port) => port.terminations())).toEqual([1, 1]);
  });
});

describe('the worker body enforces the bounds itself', () => {
  /**
   * Mutation-relevant. `kdf-param-bounds.test.ts` proves the *main thread*
   * rejects out-of-range parameters before spawning anything; that proves
   * nothing about the worker, which is a separate entry point whose `onmessage`
   * accepts whatever the page posts. Removing `assertDeriveInputs` from
   * `handleDeriveRequest` would leave those tests green and leave the worker
   * willing to burn a whole thread on a hostile `meta` row.
   *
   * Each set below is *cheap* to derive, deliberately: if the check were gone
   * the response would be `derived` rather than `error`, and the test would
   * fail in milliseconds instead of hanging for half a minute.
   */
  const outOfRange: ReadonlyArray<[string, Argon2idParams]> = [
    [
      'under the memory floor',
      { memorySizeKib: 19_455, iterations: 4, parallelism: 1 },
    ],
    [
      'under the cost floor',
      { memorySizeKib: 32_768, iterations: 1, parallelism: 1 },
    ],
    [
      'over the iteration ceiling',
      { memorySizeKib: 19_456, iterations: 17, parallelism: 1 },
    ],
    [
      'over the memory ceiling',
      { memorySizeKib: 262_145, iterations: 1, parallelism: 1 },
    ],
  ];

  it.each(outOfRange)(
    'answers params %s with params/invalid and never starts deriving',
    async (_label, params) => {
      const posted: KdfWorkerResponse[] = [];
      await handleDeriveRequest(
        { kind: 'derive', password: PASSWORD, salt: SALT, params },
        (response) => posted.push(response),
      );
      expect(posted).toEqual([
        { kind: 'error', code: 'params/invalid', message: expect.any(String) },
      ]);
    },
  );

  it.each([
    ['an empty password', '', 'password/empty'],
    ['an over-long password', 'x'.repeat(1025), 'password/too-long'],
  ])('answers %s with %s', async (_label, password, code) => {
    const posted: KdfWorkerResponse[] = [];
    await handleDeriveRequest(
      { kind: 'derive', password, salt: SALT, params: CHEAP_PARAMS },
      (response) => posted.push(response),
    );
    expect(posted).toEqual([
      { kind: 'error', code, message: expect.any(String) },
    ]);
  });

  it('answers a message it does not understand without throwing', async () => {
    const posted: KdfWorkerResponse[] = [];
    await handleDeriveRequest({ kind: 'nonsense' }, (response) =>
      posted.push(response),
    );
    expect(posted).toEqual([
      { kind: 'error', code: 'worker/failed', message: expect.any(String) },
    ]);
  });

  it('does derive for in-range params (the control)', async () => {
    const posted: KdfWorkerResponse[] = [];
    await handleDeriveRequest(
      { kind: 'derive', password: PASSWORD, salt: SALT, params: CHEAP_PARAMS },
      (response) => posted.push(response),
    );
    expect(posted.map((response) => response.kind)).toEqual([
      'deriving',
      'derived',
    ]);
  });
});

describe('the busy signal', () => {
  it('reports starting, deriving and settled, in that order', async () => {
    const states: KdfDerivationState[] = [];
    await deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
      createWorker: recordingKdfWorkerFactory(),
      onStateChange: (state) => states.push(state),
    });
    expect(states).toEqual(['starting', 'deriving', 'settled']);
  });

  it('still settles when the derivation fails, so a spinner cannot stick', async () => {
    const states: KdfDerivationState[] = [];
    await expect(
      deriveMasterKey(PASSWORD, SALT, CHEAP_PARAMS, {
        createWorker: () => createInProcessKdfWorker({ failWith: 'boom' }),
        onStateChange: (state) => states.push(state),
      }),
    ).rejects.toThrow();
    expect(states).toEqual(['starting', 'settled']);
  });
});

describe('the worker entry point', () => {
  it('does not attach a message listener outside a dedicated worker', () => {
    // Imported in Node, this module must be inert. If it were not, importing it
    // on the main thread would install a `message` listener on the page that
    // answers with derived key handles.
    expect(installKdfWorkerHandler(globalThis)).toBe(false);
  });

  it('attaches inside a dedicated worker scope and answers a derive request', async () => {
    class DedicatedWorkerGlobalScope {}
    const posted: KdfWorkerResponse[] = [];
    let receive: ((event: { data: unknown }) => void) | undefined;

    const scope = Object.assign(new DedicatedWorkerGlobalScope(), {
      DedicatedWorkerGlobalScope,
      postMessage: (message: unknown) =>
        posted.push(message as KdfWorkerResponse),
      addEventListener: (
        _type: 'message',
        listener: (event: { data: unknown }) => void,
      ) => {
        receive = listener;
      },
    }) as unknown as typeof globalThis;

    expect(installKdfWorkerHandler(scope)).toBe(true);
    expect(receive).toBeDefined();

    receive?.({
      data: {
        kind: 'derive',
        password: PASSWORD,
        salt: SALT,
        params: CHEAP_PARAMS,
      },
    });
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted.map((response) => response.kind)).toEqual([
      'deriving',
      'derived',
    ]);
    expect(scan(posted).buffers).toEqual([]);
  });
});

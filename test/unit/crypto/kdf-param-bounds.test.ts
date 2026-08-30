/**
 * "Rejected *before* any derivation begins."
 *
 * The sibling suite (`kdf.test.ts`) proves out-of-range parameters are rejected,
 * and proves it happens fast. Neither shows *structurally* that Argon2id was
 * never entered — a check that ran halfway through the digest and threw would
 * still produce an error, and a check that ran after a cheap-but-real digest
 * would still look quick.
 *
 * So this file stubs `hash-wasm` and asserts the thing the acceptance criterion
 * actually says: `deriveMasterKey` must reject with zero calls to `argon2id`.
 * That is what makes the bound a denial-of-service defence rather than a late
 * error message — the whole point of finding S-4 is that the work must not
 * start.
 *
 * Since #61 there are **two** places the bound has to hold, and this file
 * asserts both:
 *
 *   · on the main thread, before a worker is spawned at all — hence the
 *     `createWorker` recorder and its `ports` assertions. Spawning a thread and
 *     an Argon2 WebAssembly instance to be told the parameters were absurd
 *     would be a smaller denial of service than S-4, but it would still be one,
 *     and it is not what "before any expensive work" means;
 *   · inside the worker, which is a separate entry point that accepts whatever
 *     the page posts it — asserted in `kdf-worker.test.ts` against
 *     `handleDeriveRequest` directly, because a check that exists only on the
 *     caller's side is not a check the worker has.
 *
 * `vi.mock` is file-scoped and hoisted, which is why this lives in its own file
 * rather than in `kdf.test.ts`, where the real hash-wasm has to run for the
 * reference known-answer vectors.
 */

import { argon2id } from 'hash-wasm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARGON2ID_DEFAULT_PARAMS,
  type Argon2idParams,
  deriveMasterKey,
  MASTER_KEY_LENGTH_BYTES,
} from '../../../app/crypto/kdf';
import { argon2idDigestForVectorTests } from '../../../app/crypto/kdf-worker-body';
import {
  type RecordingKdfWorkerFactory,
  recordingKdfWorkerFactory,
} from '../../support/kdf-worker-port';

vi.mock('hash-wasm', () => ({
  // A stub that returns a well-formed 32-byte digest instantly. Any call at all
  // is a failure for the rejection cases below; the control cases need it to
  // return something `importKey` accepts.
  argon2id: vi.fn(async () => new Uint8Array(MASTER_KEY_LENGTH_BYTES).fill(1)),
}));

const argon2idStub = vi.mocked(argon2id);

const SALT = new Uint8Array(16).fill(0x2a);
const PASSWORD = 'correct horse battery staple';

/**
 * One case per bound, each one step outside exactly that bound. Deriving any of
 * the over-ceiling sets for real would cost between 0.6 s and 36.5 s (measured,
 * M4); with the stub in place they cost nothing, which is only true because the
 * check runs first.
 */
const OVER_CEILING: ReadonlyArray<[string, Argon2idParams]> = [
  [
    'over the memory ceiling',
    { memorySizeKib: 262_145, iterations: 1, parallelism: 1 },
  ],
  [
    'over the iteration ceiling',
    { memorySizeKib: 19_456, iterations: 17, parallelism: 1 },
  ],
  [
    'over the cost ceiling',
    { memorySizeKib: 262_144, iterations: 8, parallelism: 1 },
  ],
  [
    'the 1 GiB x 64-pass parameters from finding S-4',
    { memorySizeKib: 1_048_576, iterations: 64, parallelism: 1 },
  ],
];

const BELOW_FLOOR: ReadonlyArray<[string, Argon2idParams]> = [
  [
    'under the memory floor',
    { memorySizeKib: 19_455, iterations: 4, parallelism: 1 },
  ],
  [
    'under the cost floor',
    { memorySizeKib: 32_768, iterations: 1, parallelism: 1 },
  ],
];

const OUT_OF_RANGE = [...OVER_CEILING, ...BELOW_FLOOR];

describe('deriveMasterKey — out-of-range params never reach Argon2id', () => {
  let workers: RecordingKdfWorkerFactory;

  beforeEach(() => {
    argon2idStub.mockClear();
    workers = recordingKdfWorkerFactory();
  });

  const derive = (params: Argon2idParams) =>
    deriveMasterKey(PASSWORD, SALT, params, { createWorker: workers });

  it.each(OUT_OF_RANGE)(
    'rejects params %s without calling argon2id, or spawning a worker',
    async (_label, params) => {
      await expect(derive(params)).rejects.toMatchObject({
        code: 'params/invalid',
      });
      expect(argon2idStub).not.toHaveBeenCalled();
      // The bound is checked on this thread, so nothing is spawned to check it
      // on. If this ever reads 1, validation has drifted into the worker only
      // and a hostile `meta` row costs a thread and a WebAssembly instance
      // before it costs an error.
      expect(workers.ports).toHaveLength(0);
    },
  );

  it.each(OVER_CEILING)(
    'rejects params %s in the vector helper too, without calling argon2id',
    async (_label, params) => {
      await expect(
        argon2idDigestForVectorTests(
          new TextEncoder().encode(PASSWORD),
          SALT,
          params,
          MASTER_KEY_LENGTH_BYTES,
        ),
      ).rejects.toMatchObject({ code: 'params/invalid' });
      expect(argon2idStub).not.toHaveBeenCalled();
    },
  );

  it.each(BELOW_FLOOR)(
    'lets the vector helper run params %s — it skips the floor by design',
    async (_label, params) => {
      // The published reference vectors are deliberately weak, so the test-only
      // helper documents itself as bypassing the strength floor. Asserting that
      // here keeps the split honest: it is a stated exemption, not an accident,
      // and it does not extend to the ceiling above.
      await argon2idDigestForVectorTests(
        new TextEncoder().encode(PASSWORD),
        SALT,
        params,
        MASTER_KEY_LENGTH_BYTES,
      );
      expect(argon2idStub).toHaveBeenCalledTimes(1);
    },
  );

  /**
   * The control. Without this, "argon2id was never called" would also pass if
   * the stub were mis-wired and the spy could never be called at all.
   */
  it('does call argon2id for in-range params', async () => {
    await derive(ARGON2ID_DEFAULT_PARAMS);
    expect(argon2idStub).toHaveBeenCalledTimes(1);
    // And the other half of the control: in-range parameters *do* spawn exactly
    // one worker, so "no worker was spawned" above means the rejection stopped
    // it and not that the factory was never wired up.
    expect(workers.ports).toHaveLength(1);
    expect(argon2idStub).toHaveBeenCalledWith(
      expect.objectContaining({
        memorySize: ARGON2ID_DEFAULT_PARAMS.memorySizeKib,
        iterations: ARGON2ID_DEFAULT_PARAMS.iterations,
        parallelism: ARGON2ID_DEFAULT_PARAMS.parallelism,
      }),
    );
  });

  /**
   * Ordering: parameters are validated before the password is even encoded or
   * posted anywhere, so nothing derived from the secret is materialised — or
   * copied into a second realm — for a request that was never going to run.
   */
  it('rejects out-of-range params even when every other input is valid', async () => {
    await expect(
      derive({ memorySizeKib: 1_048_576, iterations: 64, parallelism: 1 }),
    ).rejects.toMatchObject({ code: 'params/invalid' });
    expect(argon2idStub).not.toHaveBeenCalled();
    expect(workers.ports).toHaveLength(0);
  });
});

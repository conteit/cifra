/**
 * An in-process stand-in for the Argon2id derivation worker, plus the recording
 * hooks the boundary assertions need.
 *
 * ## Why this exists rather than a real worker
 *
 * The `unit` Vitest project runs in Node with no browser, and CLAUDE.md makes
 * that a rule: "nothing in this project may need Playwright". Node 24 has
 * `node:worker_threads`, not the DOM `Worker`, so `createBrowserKdfWorker`
 * cannot run here. `deriveMasterKey` therefore takes an injectable
 * {@link KdfWorkerFactory} and these ports supply it.
 *
 * ## Why it is not a mock
 *
 * Everything that crosses the seam goes through **`structuredClone`**, in both
 * directions, exactly as `postMessage` would. That is not decoration: it is the
 * property under test. Node 24 and Chromium both serialize a non-extractable
 * `CryptoKey` with `extractable`, `algorithm` and `usages` intact and no way to
 * read its bytes, and these tests only prove the design because the clone is
 * real. A hand-rolled pass-through would have proved that objects can be passed
 * to functions.
 *
 * The request is handled by the real `handleDeriveRequest` from
 * `app/crypto/kdf-worker-body.ts` — the shipping worker logic, not an
 * imitation of it.
 *
 * ## What it records
 *
 * Every response the worker side posted, **before** it was cloned and before
 * the client saw it, so `test/unit/crypto/kdf-worker-boundary.test.ts` can scan
 * the raw traffic for key material with `test/support/raw-scan.ts`. Plus the
 * number of `terminate()` calls, which is how the worker-leak assertions are
 * written.
 */

import { handleDeriveRequest } from '../../app/crypto/kdf-worker-body';
import type {
  KdfDeriveRequest,
  KdfWorkerPort,
  KdfWorkerResponse,
} from '../../app/crypto/kdf-worker-client';

export interface RecordingKdfWorkerPort extends KdfWorkerPort {
  /** Requests the client posted, as the worker side received them. */
  readonly requests: KdfDeriveRequest[];
  /** Everything the worker side posted back, captured before serialization. */
  readonly responses: unknown[];
  /** How many times {@link KdfWorkerPort.terminate} was called. */
  readonly terminations: () => number;
  /** Whether the port is still live — i.e. has not been terminated. */
  readonly live: () => boolean;
}

/** How a port should misbehave, for the failure-path tests. */
export interface KdfWorkerPortBehaviour {
  /**
   * Replaces the worker side entirely. Receives the cloned request and the
   * `post` callback; anything it posts travels the same clone path.
   */
  readonly handle?: (
    request: unknown,
    post: (response: unknown) => void,
  ) => void | Promise<void>;
  /** Fires the out-of-band failure channel instead of handling the request. */
  readonly failWith?: string;
}

/**
 * Builds a port that routes the client's request into the real worker body,
 * through `structuredClone` in both directions.
 */
export function createInProcessKdfWorker(
  behaviour: KdfWorkerPortBehaviour = {},
): RecordingKdfWorkerPort {
  const requests: KdfDeriveRequest[] = [];
  const responses: unknown[] = [];
  let terminations = 0;
  let responseListener: ((response: KdfWorkerResponse) => void) | undefined;
  let failureListener: ((reason: string) => void) | undefined;

  const live = () => terminations === 0;

  // A terminated worker cannot deliver anything, so neither can this. Without
  // it a "did we terminate?" test could pass while the port kept talking, which
  // is the leak it is supposed to catch.
  const post = (response: unknown) => {
    responses.push(response);
    if (!live()) return;
    responseListener?.(structuredClone(response) as KdfWorkerResponse);
  };

  return {
    requests,
    responses,
    terminations: () => terminations,
    live,
    post(request) {
      const delivered = structuredClone(request);
      requests.push(delivered);
      if (behaviour.failWith !== undefined) {
        const reason = behaviour.failWith;
        queueMicrotask(() => {
          if (live()) failureListener?.(reason);
        });
        return;
      }
      const handle = behaviour.handle ?? handleDeriveRequest;
      void Promise.resolve(handle(delivered, post));
    },
    onResponse(listener) {
      responseListener = listener;
    },
    onFailure(listener) {
      failureListener = listener;
    },
    terminate() {
      terminations += 1;
      responseListener = undefined;
      failureListener = undefined;
    },
  };
}

/**
 * The factory shape `deriveMasterKey` takes, remembering every port it built so
 * a test can assert how many workers a call spawned and that each was
 * terminated.
 */
export interface RecordingKdfWorkerFactory {
  (): RecordingKdfWorkerPort;
  /** Every port handed out, in order. */
  readonly ports: RecordingKdfWorkerPort[];
}

export function recordingKdfWorkerFactory(
  behaviour: KdfWorkerPortBehaviour = {},
): RecordingKdfWorkerFactory {
  const ports: RecordingKdfWorkerPort[] = [];
  const factory = (): RecordingKdfWorkerPort => {
    const port = createInProcessKdfWorker(behaviour);
    ports.push(port);
    return port;
  };
  return Object.assign(factory, { ports });
}

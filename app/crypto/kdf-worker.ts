/**
 * The dedicated-worker entry point for Argon2id derivation.
 *
 * Governed by `docs/architecture.md` §Crypto (Key hierarchy step 2) and D22.
 *
 * This file is deliberately the thinnest thing in the crypto layer: bind the
 * worker scope's `message` event to `handleDeriveRequest` and post whatever it
 * produces. All of the logic, and all of the tests, live in
 * `kdf-worker-body.ts`, which is a plain async function and therefore runs in
 * the browser-free `unit` Vitest project.
 *
 * It is referenced only as `new URL('./kdf-worker.ts', import.meta.url)` from
 * `kdf-worker-client.ts`, which is what makes Vite emit it as its own chunk
 * with `hash-wasm` behind it, and what keeps the Argon2id implementation off
 * the main thread's module graph.
 *
 * ## Why it checks the scope before attaching anything
 *
 * `globalThis.addEventListener('message', …)` is also a perfectly valid thing to
 * do on a `Window`. If this module were ever imported from the page — by a
 * mistaken static import, or by a bundler that decided to inline the worker
 * chunk — it would silently install a page-wide `message` listener that
 * answers cross-origin `postMessage` with derived key handles. Refusing to
 * attach outside a `DedicatedWorkerGlobalScope` makes that import inert instead
 * of dangerous, and `test/unit/crypto/kdf-worker-entry.test.ts` imports the
 * module in Node to prove it.
 */

import { handleDeriveRequest } from './kdf-worker-body';

/** The slice of `DedicatedWorkerGlobalScope` this file uses. */
interface DedicatedWorkerScope {
  postMessage(message: unknown): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
}

/**
 * True only inside a dedicated worker.
 *
 * `DedicatedWorkerGlobalScope` is not in the `DOM` lib this project compiles
 * against, so it is read off the global object rather than named. `instanceof`
 * against the constructor the realm itself exposes is the check that cannot be
 * faked by a `Window` that happens to have the right methods — and it is not
 * `importScripts`, which module workers do not have at all.
 */
function isDedicatedWorkerScope(scope: typeof globalThis): boolean {
  const scopeType = (
    scope as { DedicatedWorkerGlobalScope?: new () => unknown }
  ).DedicatedWorkerGlobalScope;
  return typeof scopeType === 'function' && scope instanceof scopeType;
}

/**
 * Attaches the handler, and reports whether it did.
 *
 * Exported so a test can assert the guard's *decision* rather than its absence
 * of side effects, which is the kind of negative that quietly stops meaning
 * anything.
 */
export function installKdfWorkerHandler(scope: typeof globalThis): boolean {
  if (!isDedicatedWorkerScope(scope)) return false;

  const worker = scope as unknown as DedicatedWorkerScope;
  worker.addEventListener('message', (event) => {
    void handleDeriveRequest(event.data, (response) => {
      worker.postMessage(response);
    });
  });
  return true;
}

installKdfWorkerHandler(globalThis);

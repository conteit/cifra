import { expect, type Page, test, type Worker } from '@playwright/test';

import type { DbTestApi } from '../../app/db/db-test-api';
import { DB_TEST_HANDLE } from '../../app/db/db-test-handle';

/**
 * Issue #61 — **Argon2id, in a real Web Worker, in a real browser.**
 *
 * ## What only this file can prove
 *
 * `test/unit/crypto/kdf-worker.test.ts` drives the shipping worker body through
 * a genuine `structuredClone` boundary in Node, and
 * `test/unit/crypto/kdf-worker-boundary.test.ts` proves the main thread's module
 * graph cannot reach an Argon2id implementation. Neither of them constructs a
 * `Worker`. Three things therefore have no meaning until they are checked here:
 *
 *   1. **Vite emits the worker chunk and the page can boot it.**
 *      `new URL('./kdf-worker.ts', import.meta.url)` is a build-time contract
 *      with the bundler; if it broke, `verify` would stay green and every
 *      unlock would fail at runtime.
 *   2. **The main thread stays responsive.** That is the whole issue. A
 *      heartbeat runs on the page's own event loop across the derivation, and
 *      its worst gap is compared against the derivation's duration — if the
 *      digest ran here, one gap would swallow the whole thing.
 *   3. **The worker is actually released.** An un-terminated worker holds a
 *      thread and, because WebAssembly linear memory never shrinks, at least
 *      the 64 MiB Argon2 block array, for the life of the tab. The unit suite
 *      counts `terminate()` calls on a fake; here Chromium itself is asked
 *      whether the worker is gone.
 *
 * ## How it reaches the crypto layer
 *
 * Through `window[DB_TEST_HANDLE]`, the same build-gated seam
 * `test/e2e/db-liveness.spec.ts` uses (#42). `app/db/db-test-handle.ts` carries
 * the argument for it and the plan to delete it once #9 and #10 ship a real
 * unlock screen — at which point this spec should drive *that* instead, which
 * is the only way to exercise the spinner as well as the worker.
 *
 * There is no sign-in here: `docs/architecture.md` §Crypto step 1 keeps
 * identity away from encryption material, and the key hierarchy starts at the
 * master password.
 */

test.describe.configure({ mode: 'serial' });

/** What a page-side derivation reports back. Only serializable values. */
interface DerivationReport {
  /** Wall time of the whole `deriveMasterKey` call, in ms. */
  readonly elapsedMs: number;
  /** How many times the main thread's heartbeat ran during it. */
  readonly ticks: number;
  /** The worst gap between two heartbeats, in ms. */
  readonly maxGapMs: number;
  readonly states: string[];
  readonly extractable: boolean;
  readonly algorithm: string;
  readonly usages: string[];
  /** What `exportKey` did — the guarantee, asked of the receiving realm. */
  readonly exportKey: string;
  /** Length of an AES-KW wrap performed with the received key. */
  readonly wrappedLength: number;
  /** The same wrap as hex, so two derivations can be compared. */
  readonly wrappedHex: string;
}

/**
 * Derives once in page context while measuring the main thread.
 *
 * The heartbeat is a self-rescheduling `setTimeout`, which is the most honest
 * probe available: it is serviced from the same task queue a click handler or a
 * React render would be, so a gap in it is exactly the jank a user feels.
 * `requestAnimationFrame` would have been throttled by the compositor and would
 * have measured the wrong thing.
 */
async function deriveInPage(page: Page): Promise<DerivationReport> {
  return await page.evaluate(async (handle: string) => {
    const api = (globalThis as unknown as Record<string, unknown>)[
      handle
    ] as DbTestApi;

    const gaps: number[] = [];
    let beating = true;
    let previous = performance.now();
    const beat = () => {
      if (!beating) return;
      const now = performance.now();
      gaps.push(now - previous);
      previous = now;
      setTimeout(beat, 0);
    };
    setTimeout(beat, 0);

    const states: string[] = [];
    const salt = api.generateSalt();
    const startedAt = performance.now();
    const key = await api.deriveMasterKey(
      'cifra e2e — parola d’ordine lunga e distintiva',
      salt,
      api.ARGON2ID_DEFAULT_PARAMS,
      { onStateChange: (state) => states.push(state) },
    );
    const elapsedMs = performance.now() - startedAt;
    beating = false;

    let exportKey: string;
    try {
      await crypto.subtle.exportKey('raw', key);
      exportKey = 'succeeded';
    } catch (error) {
      exportKey = `rejected: ${(error as Error).name}`;
    }

    const probe = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(32).fill(0x5a),
      'AES-GCM',
      true,
      ['encrypt'],
    );
    const wrapped = new Uint8Array(
      await crypto.subtle.wrapKey('raw', probe, key, 'AES-KW'),
    );

    return {
      elapsedMs,
      ticks: gaps.length,
      maxGapMs: gaps.length === 0 ? elapsedMs : Math.max(...gaps),
      states,
      extractable: key.extractable,
      algorithm: key.algorithm.name,
      usages: [...key.usages].sort(),
      exportKey,
      wrappedLength: wrapped.length,
      wrappedHex: Array.from(wrapped, (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
    };
  }, DB_TEST_HANDLE);
}

let page: Page;
let workersSeen: Worker[];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  workersSeen = [];
  page.on('worker', (worker) => workersSeen.push(worker));
  await page.goto('/');
  await page.waitForFunction(
    (handle) => (globalThis as Record<string, unknown>)[handle] !== undefined,
    DB_TEST_HANDLE,
    { timeout: 30_000 },
  );
});

test.afterAll(async () => {
  await page.close();
});

test('derives in a dedicated worker without blocking the main thread', async () => {
  const report = await deriveInPage(page);

  // Sanity: the work was real. Without this the responsiveness assertion below
  // would also pass for a derivation that never happened.
  expect(report.elapsedMs).toBeGreaterThan(20);
  expect(report.wrappedLength).toBe(40);

  // A real dedicated worker booted, and it was the emitted chunk.
  expect(workersSeen.map((worker) => worker.url()).join('\n')).toContain(
    'kdf-worker',
  );

  // The point of the issue. If Argon2id ran on this thread the heartbeat would
  // have stopped for the whole derivation, so its worst gap would be the
  // derivation's own duration. Stated as a ratio rather than a millisecond
  // budget so a slow CI machine cannot make it flaky: a blocked thread fails it
  // at any speed, and an unblocked one passes at any speed.
  expect(report.ticks).toBeGreaterThan(5);
  expect(report.maxGapMs).toBeLessThan(report.elapsedMs * 0.6);

  console.log(
    `[#61] derivation ${report.elapsedMs.toFixed(0)} ms, ` +
      `${report.ticks} main-thread ticks, worst gap ${report.maxGapMs.toFixed(1)} ms`,
  );
});

test('hands the page a key it can use and cannot read', async () => {
  const report = await deriveInPage(page);

  expect(report.extractable).toBe(false);
  expect(report.algorithm).toBe('AES-KW');
  expect(report.usages).toEqual(['unwrapKey', 'wrapKey']);
  // Asked of the *receiving* realm, after structured clone. This is the
  // guarantee #61 had to preserve: the key crossed a thread boundary and is
  // still opaque.
  expect(report.exportKey).toBe('rejected: InvalidAccessError');
  // ...and it is a working key, not an empty handle: AES-KW turns 32 bytes into
  // 40, and the wrap could not have been computed without the material.
  expect(report.wrappedHex).toHaveLength(80);

  // The busy signal a real worker produces, in order. `deriving` is posted from
  // inside the worker after its module graph and the Argon2 WebAssembly module
  // have loaded, so its arrival is evidence the worker really booted.
  expect(report.states).toEqual(['starting', 'deriving', 'settled']);
});

test('the same password and salt derive the same key across workers', async () => {
  // Each call spawns its own worker, so this also shows a fresh worker is
  // equivalent to a reused one — which is what makes the per-derivation
  // lifecycle a free choice rather than a behavioural change.
  const first = await page.evaluate(async (handle: string) => {
    const api = (globalThis as unknown as Record<string, unknown>)[
      handle
    ] as DbTestApi;
    const salt = api.generateSalt();
    const wrap = async () => {
      const key = await api.deriveMasterKey(
        'cifra e2e — parola d’ordine lunga e distintiva',
        salt,
        api.ARGON2ID_DEFAULT_PARAMS,
      );
      const probe = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(32).fill(0x5a),
        'AES-GCM',
        true,
        ['encrypt'],
      );
      return Array.from(
        new Uint8Array(
          await crypto.subtle.wrapKey('raw', probe, key, 'AES-KW'),
        ),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
    };
    return [await wrap(), await wrap()];
  }, DB_TEST_HANDLE);

  expect(first[0]).toBe(first[1]);
  expect(first[0]).toHaveLength(80);
});

test('terminates every worker it spawns', async () => {
  // Chromium's own answer, not a counter on a fake. `page.workers()` lists live
  // dedicated workers (service workers are not included), so an un-terminated
  // derivation worker would still be here after every test above has run.
  expect(workersSeen.length).toBeGreaterThanOrEqual(4);
  await expect.poll(() => page.workers().length, { timeout: 10_000 }).toBe(0);
});

test('does not derive on the main thread when the password is refused', async () => {
  const spawnedBefore = workersSeen.length;
  const outcome = await page.evaluate(async (handle: string) => {
    const api = (globalThis as unknown as Record<string, unknown>)[
      handle
    ] as DbTestApi;
    try {
      await api.deriveMasterKey('', api.generateSalt());
      return 'resolved';
    } catch (error) {
      return (error as { code?: string }).code ?? (error as Error).name;
    }
  }, DB_TEST_HANDLE);

  expect(outcome).toBe('password/empty');
  // D19's bound, in a browser: a rejected request costs no thread at all.
  expect(workersSeen).toHaveLength(spawnedBefore);
});

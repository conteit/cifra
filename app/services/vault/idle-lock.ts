/**
 * The idle auto-lock (FOUN-10, #10): after `timeoutMs` without user input the
 * data key must go, and it must go the moment the page is left.
 *
 * ## Why a timestamp and an interval, not a resettable timeout
 *
 * A `setTimeout` reset on every input is the obvious shape and the wrong one
 * on a phone. A background tab's timers are throttled, then suspended; a tab
 * brought back after an hour would still be waiting on a timeout that never
 * ran, with the data key live the whole time. So the deadline is a *wall-clock*
 * fact — `lastInput + timeoutMs` — and three things compare against it: a
 * coarse interval while the tab runs, `visibilitychange` when it comes back
 * (that is the suspended-tab case: the clock has moved, the interval has not),
 * and nothing else. Input only stamps a number, which is cheap enough to do on
 * every scroll event without throttling.
 *
 * `pagehide` fires on close, on navigation away and on entry to the
 * back-forward cache — the one case where a page's module memory *survives*
 * being left. A `lock()` there costs a re-entered password on a bfcache
 * restore and buys a key that never outlives the page it was derived on.
 *
 * ## Boundaries
 *
 * Pure TypeScript over an `EventTarget`; the app passes `window`, on which
 * every input event bubbles and `visibilitychange` arrives from `document`.
 * No React, no store, no crypto: the caller decides what "idle" means to it
 * (`app/stores/vault-instance.ts` maps it to `vault.lock('idle')`). Fires at
 * most once, then unregisters itself, because the thing it guards is gone.
 */

const INPUT_EVENTS = [
  'pointerdown',
  'keydown',
  'touchstart',
  'wheel',
  'scroll',
] as const;

/**
 * Capture so a handler that stops propagation cannot hide input from the
 * lock; passive because the listener never calls `preventDefault`, and a
 * non-passive `touchstart`/`wheel` listener on `window` would cost every
 * scroll a main-thread round-trip.
 */
const LISTENER_OPTIONS: AddEventListenerOptions = {
  capture: true,
  passive: true,
};

/** FOUN-10: thirty minutes without input drops the data key. */
export const VAULT_IDLE_TIMEOUT_MS = 30 * 60_000;

/** How often a running tab re-checks the deadline. Coarse on purpose. */
const CHECK_INTERVAL_MS = 60_000;

export interface IdleLockOptions {
  /** Where input, `visibilitychange` and `pagehide` are observed. `window`. */
  readonly target: Pick<
    EventTarget,
    'addEventListener' | 'removeEventListener'
  >;
  /** Input silence that counts as idle, in milliseconds. */
  readonly timeoutMs: number;
  /** `document.visibilityState`, read on `visibilitychange`. */
  readonly visibilityState: () => DocumentVisibilityState;
  /** Called exactly once, on idle or on leaving the page. */
  readonly onIdle: () => void;
}

/** Starts watching. Returns the function that stops watching. */
export function startIdleLock(options: IdleLockOptions): () => void {
  const { target, timeoutMs, visibilityState, onIdle } = options;
  let lastInput = Date.now();
  let stopped = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    for (const type of INPUT_EVENTS) {
      target.removeEventListener(type, onInput, LISTENER_OPTIONS);
    }
    target.removeEventListener('visibilitychange', onVisibilityChange);
    target.removeEventListener('pagehide', fire);
  };

  const fire = (): void => {
    if (stopped) return;
    stop();
    onIdle();
  };

  const check = (): void => {
    if (Date.now() - lastInput >= timeoutMs) fire();
  };

  const onInput = (): void => {
    lastInput = Date.now();
  };

  const onVisibilityChange = (): void => {
    if (visibilityState() === 'visible') check();
  };

  const interval = setInterval(check, CHECK_INTERVAL_MS);
  for (const type of INPUT_EVENTS) {
    target.addEventListener(type, onInput, LISTENER_OPTIONS);
  }
  target.addEventListener('visibilitychange', onVisibilityChange);
  target.addEventListener('pagehide', fire);

  return stop;
}

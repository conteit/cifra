import type { VaultStore } from './vault';

export interface IdleLockWiring {
  /** Starts a watcher that calls `onIdle` at most once; returns its stop. */
  readonly start: (onIdle: () => void) => () => void;
}

/**
 * Runs an idle watcher exactly while the vault holds a data key (#10).
 *
 * Subscribed to the store rather than mounted in a component for the same
 * reason the sign-out edge is: the key is dropped whether or not anything is
 * on screen. The watcher is started on the `unlocked` transition and stopped
 * on the way out — a locked vault has nothing to guard and must not keep a
 * timer or five window listeners alive for it — and an idle fire is just
 * `lock('idle')`, the same action the header button calls with a different
 * reason.
 *
 * Takes the watcher as a function so the store test can drive this edge with
 * a fake and `app/services/vault/idle-lock.ts` keeps its own clock suite.
 */
export function wireIdleLock(store: VaultStore, wiring: IdleLockWiring): void {
  let stop: (() => void) | null = null;

  const sync = (unlocked: boolean): void => {
    if (unlocked && stop === null) {
      stop = wiring.start(() => store.getState().lock('idle'));
    } else if (!unlocked && stop !== null) {
      stop();
      stop = null;
    }
  };

  store.subscribe((state, previous) => {
    if (state.status !== previous.status) sync(state.status === 'unlocked');
  });
  sync(store.getState().status === 'unlocked');
}

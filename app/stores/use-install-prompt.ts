import { useSyncExternalStore } from 'react';

import type { InstallAffordance } from '../services/pwa/install-prompt';
import { getInstallPromptController } from './install-prompt-instance';

/**
 * React binding for the install-prompt controller.
 *
 * `useSyncExternalStore` rather than Zustand: the controller's state is not
 * app state that anything sets, it is a mirror of two browser events and one
 * media query, and the controller already exposes the exact
 * `subscribe`/`getSnapshot` pair React wants. Wrapping it in a store would add
 * a copy of the truth to keep in step with the browser.
 *
 * The server snapshot is `'hidden'`: the prerendered document is built in Node
 * (see `app/root.tsx`), where nothing is installable and nothing has been
 * dismissed.
 */
export interface InstallPromptBinding {
  readonly state: InstallAffordance;
  /** Fires the captured browser prompt. Must be called from a user gesture. */
  install(): void;
  /** Hides the affordance on this device for good. */
  dismiss(): void;
}

const serverSnapshot = (): InstallAffordance => 'hidden';

export function useInstallPrompt(): InstallPromptBinding {
  const controller = getInstallPromptController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    serverSnapshot,
  );

  return {
    state,
    install: () => {
      void controller.install();
    },
    dismiss: () => {
      controller.dismiss();
    },
  };
}

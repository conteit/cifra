import { useEffect } from 'react';
import { useStore } from 'zustand';

import { getSessionStore } from './session-instance';
import type { SessionState } from './session';

/**
 * React bindings for the session store. This is the only auth module that
 * imports React — the store itself is plain `zustand/vanilla` so it can be unit
 * tested as pure TS (docs/architecture.md §Workflow §Testing).
 */

/** Subscribe a component to a slice of session state. */
export function useSession<T>(selector: (state: SessionState) => T): T {
  return useStore(getSessionStore(), selector);
}

/** The store's actions, for components that need to trigger sign-in/sign-out. */
export function useSessionActions(): Pick<
  SessionState,
  'signIn' | 'signOut' | 'clearError'
> {
  const signIn = useStore(getSessionStore(), (s) => s.signIn);
  const signOut = useStore(getSessionStore(), (s) => s.signOut);
  const clearError = useStore(getSessionStore(), (s) => s.clearError);
  return { signIn, signOut, clearError };
}

/**
 * Starts observing the identity provider for as long as the calling component
 * is mounted. Mounted once, at the root. Idempotent, so a remount during React
 * strict-mode double-invocation does not open a second subscription.
 */
export function useSessionBootstrap(): void {
  useEffect(() => getSessionStore().getState().start(), []);
}

import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  DEFAULT_LOCALE,
  detectLocale,
  type Locale,
  type Strings,
  stringsFor,
} from '../i18n';

/**
 * The locale store: which language the UI is in, and the table that follows
 * from it.
 *
 * ## Why a store and not a module constant
 *
 * The `app/ui` primitives and the `AppShell` take every user-facing string as
 * a prop — they have no locale of their own, and that stays true. Something
 * above them has to hold the answer, and `docs/architecture.md` §Stack and
 * layering names it: `pages → stores → services → db → crypto`. A page reads
 * state from a store; it does not reach past one into a module that resolved
 * something at import time.
 *
 * A module-scope constant would have worked for detection alone. It would not
 * have worked for the next requirement: ACCT-02 ("Language selector — System /
 * English / Italiano") changes the locale *while the app is running*, and a
 * constant cannot re-render anything. Zustand is already the stack's state
 * layer (§Stack and layering) and the session store established the shape
 * here: a plain `zustand/vanilla` store, unit-testable without React, bound to
 * React separately in `use-locale.ts`.
 *
 * ## Detection happens once
 *
 * `getLocaleStore()` resolves the browser's preference the first time it is
 * asked and caches the store. Detection is not repeated per render, and
 * {@link LocaleState.setLocale} does not re-run it — it replaces the answer.
 * That is the seam the persisted preference (#74) attaches to: it will seed
 * `createLocaleStore` from storage, falling back to `detectLocale()`, without
 * any consumer of this store changing.
 */

export interface LocaleState {
  /** The active locale. */
  readonly locale: Locale;
  /** The string table for {@link LocaleState.locale}. Kept in step by the setter. */
  readonly strings: Strings;
  /**
   * Switches the UI language. Nothing calls this yet — the language selector
   * is ACCT-02/#74, Phase 9. It exists because it is the reason this is a
   * store: a locale that can never change would not need one.
   */
  setLocale(locale: Locale): void;
}

export type LocaleStore = StoreApi<LocaleState>;

/**
 * Builds a locale store around an already-decided locale. Takes the locale
 * rather than detecting one so that tests, and later a persisted preference,
 * decide for themselves where the initial value comes from.
 */
export function createLocaleStore(
  initial: Locale = DEFAULT_LOCALE,
): LocaleStore {
  return createStore<LocaleState>()((set) => ({
    locale: initial,
    strings: stringsFor(initial),

    setLocale(locale) {
      set({ locale, strings: stringsFor(locale) });
    },
  }));
}

let instance: LocaleStore | undefined;

/**
 * The app's locale store, seeded from the browser on first use.
 *
 * Lazy for the same reason `session-instance.ts` is: importing a module must
 * not read the environment. During the SPA prerender there is no `navigator`
 * and `detectLocale()` returns {@link DEFAULT_LOCALE}, which is exactly what
 * the prerendered shell is built as — see `app/root.tsx`.
 */
export function getLocaleStore(): LocaleStore {
  instance ??= createLocaleStore(detectLocale());
  return instance;
}

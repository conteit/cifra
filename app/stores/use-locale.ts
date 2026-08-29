import { useEffect } from 'react';
import { useStore } from 'zustand';

import type { Locale, Strings } from '../i18n';
import { getLocaleStore, type LocaleState } from './locale';

/**
 * React bindings for the locale store. As with the session store, this is the
 * only locale module that imports React — `locale.ts` and `app/i18n/*` stay
 * plain TS so they can be unit tested without a DOM
 * (docs/architecture.md §Workflow §Testing).
 */

function useLocaleState<T>(selector: (state: LocaleState) => T): T {
  return useStore(getLocaleStore(), selector);
}

/** The active locale. */
export function useLocale(): Locale {
  return useLocaleState((state) => state.locale);
}

/**
 * The active string table.
 *
 * This is how a page or the shell gets its copy: `const strings = useStrings()`
 * and pass it down. Components below still receive strings as props — nothing
 * in `app/ui` or `app/shell` calls this.
 */
export function useStrings(): Strings {
  return useLocaleState((state) => state.strings);
}

/**
 * Keeps `<html lang>` in step with the active locale.
 *
 * It has to be imperative. The app is a pure SPA (`ssr: false`), so
 * `build/client/index.html` is prerendered **once, at build time**, in Node,
 * where there is no `navigator` to detect anything from — every visitor is
 * served the same file. Rendering `lang={locale}` from React would therefore
 * produce a hydration mismatch on the `<html>` element for an Italian visitor;
 * writing the attribute after mount does not, and the DOM keeps the value
 * because the JSX attribute never changes (see `app/root.tsx`).
 *
 * What a user sees in the gap: the prerendered document declares `lang="en"`
 * and contains **no copy at all** — in SPA mode the served HTML is an empty
 * root element plus the scripts (asserted by `test/e2e/locale.spec.ts`, which
 * fetches the document without running it). So the document is only ever
 * `lang="en"` while it is also wordless; the first render that puts Italian on
 * screen commits this attribute in the same React commit cycle. A screen
 * reader queries the DOM, not frames, and by the time there is anything to
 * announce, the attribute is right.
 */
export function useDocumentLocale(): void {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
}

import {
  type Locale,
  matchLocale,
  type Strings,
  stringsFor,
} from '../app/i18n';

/**
 * Story-side plumbing for the `locale` toolbar global defined in
 * `.storybook/preview.ts`.
 *
 * The UI primitives take every user-facing string as a prop — they have no
 * locale of their own — so stories are what prove the copy works in EN and IT
 * at the component level (FOUN-07). Reading the global here keeps one story
 * per state instead of two.
 *
 * The toolbar value goes through the app's own `matchLocale`, so the workbench
 * and the running app agree on what a locale is, and an unknown global falls
 * back exactly where a browser would.
 */
export type { Locale };

export type Bilingual = Record<Locale, string>;

export function localeFrom(globals: Record<string, unknown>): Locale {
  const value = globals.locale;
  return matchLocale(typeof value === 'string' ? [value] : []);
}

/** Keys whose value is a plain string rather than an interpolator. */
type StringKey = {
  [K in keyof Strings]: Strings[K] extends string ? K : never;
}[keyof Strings];

/** Reads a real app string in the active locale. */
export function t(locale: Locale, key: StringKey): string {
  return stringsFor(locale)[key];
}

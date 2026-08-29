import { en } from '../app/i18n/en';
import { it as itStrings } from '../app/i18n/it';

/**
 * Story-side plumbing for the `locale` toolbar global defined in
 * `.storybook/preview.ts`.
 *
 * The UI primitives take every user-facing string as a prop — they have no
 * locale of their own — so stories are what prove the copy works in EN and IT
 * (FOUN-07). Reading the global here keeps one story per state instead of two.
 */
export type Locale = 'en' | 'it';

export type Bilingual = Record<Locale, string>;

export function localeFrom(globals: Record<string, unknown>): Locale {
  return globals.locale === 'it' ? 'it' : 'en';
}

/** Keys whose EN value is a plain string rather than an interpolator. */
type StringKey = {
  [K in keyof typeof en]: (typeof en)[K] extends string ? K : never;
}[keyof typeof en];

/**
 * Reads a real app string in the active locale.
 *
 * `app/i18n/it` is declared as `Record<keyof typeof en, string | fn>` because a
 * handful of keys are interpolators, so a direct property read is not typed as
 * `string`. `StringKey` narrows to the plain-string keys, and the EN/IT parity
 * test guarantees the Italian side exists.
 */
export function t(locale: Locale, key: StringKey): string {
  const value: unknown = locale === 'it' ? itStrings[key] : en[key];
  return typeof value === 'string' ? value : String(value);
}

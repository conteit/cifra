import { en, type Strings } from './en';
import { it } from './it';

/* ═══════════════════════════════════════════════════════════════════════════
   Locale resolution — the runtime half of FOUN-07 ("UI supports English and
   Italian with browser auto-detection").

   Pure TypeScript: no React, no DOM API beyond an optional `navigator`-shaped
   argument, no side effects at import time. The reactive half — who holds the
   answer and how a component reads it — is `app/stores/locale.ts`; the
   `<html lang>` half is `app/root.tsx`. This module only answers two
   questions: *which locale*, and *which table*.

   ## The rule

   Walk the browser's ordered language preferences (`navigator.languages`,
   falling back to `navigator.language` when the list is absent or empty).
   Reduce each tag to its **primary language subtag** — the part before the
   first `-` or `_`, case-folded — and return the first one the app supports.
   If nothing in the list is supported, return {@link DEFAULT_LOCALE}.

   That gives, deliberately:

     · `it`, `it-IT`, `it-CH`, `IT`, `it_IT`  → `it`  (region is irrelevant:
       there is one Italian translation, not one per region)
     · `en`, `en-GB`, `en-US`                 → `en`
     · `de`, `fr-FR`, `ita`, ``, `-`, junk    → `en`  (the fallback)
     · `['fr-FR', 'it-IT', 'en']`             → `it`  (unsupported tags are
       *skipped*, not treated as a match for the fallback — so a French user
       whose second preference is Italian gets Italian)

   English is the fallback rather than Italian even though the product targets
   the Italian market: an unsupported language tag means "this user reads
   neither `en` nor `it` well", and English is the wider second language. It is
   also what the source strings are written in, so the fallback table is the
   one that can never be stale (cf. #58).

   ## Once, not reactively

   `detectLocale()` is a pure read; the *decision* is made once, when the store
   in `app/stores/locale.ts` is first constructed, and cached there for the
   lifetime of the document. A browser does not change `navigator.language`
   under a running page without a reload in practice, and re-detecting per
   render would let the answer drift mid-session for no benefit. The store is
   what makes the value replaceable — a user override (ACCT-02, Phase 9) calls
   `setLocale`, it does not re-run detection.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The locales the UI ships. EN and IT are equal peers (FOUN-07). */
export const SUPPORTED_LOCALES = ['en', 'it'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Used when the browser states no preference this app can serve. See the rule
 * above for why it is English.
 */
export const DEFAULT_LOCALE: Locale = 'en';

const TABLES: Readonly<Record<Locale, Strings>> = { en, it };

/** The shape of the environment `detectLocale` reads. `navigator` satisfies it. */
export interface LanguagePreferences {
  /** Ordered, most-preferred first. `navigator.languages`. */
  readonly languages?: readonly string[] | undefined;
  /** The single most-preferred tag. `navigator.language`. */
  readonly language?: string | undefined;
}

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * The primary language subtag of a BCP 47 tag, case-folded — `it-IT` → `it`.
 * Underscores are accepted too: some environments hand out `it_IT`.
 *
 * Returns `''` for anything that has no leading subtag, which no supported
 * locale matches, so malformed input falls through to the fallback.
 */
function primarySubtag(tag: string): string {
  return tag.trim().split(/[-_]/, 1)[0].toLowerCase();
}

/**
 * The first supported locale among `tags`, or {@link DEFAULT_LOCALE}.
 *
 * Non-string entries and malformed tags are skipped rather than ending the
 * walk — a bad entry must not cost a later, good one its match.
 */
export function matchLocale(tags: Iterable<string> | undefined | null): Locale {
  for (const tag of tags ?? []) {
    if (typeof tag !== 'string') continue;
    const primary = primarySubtag(tag);
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/**
 * The browser's ordered language tags: `navigator.languages` when it is a
 * non-empty array, otherwise the single `navigator.language`, otherwise none.
 *
 * Both are optional in the spec and both are absent outside a browser (the
 * SPA prerender runs in Node), which is why this returns an empty list rather
 * than throwing.
 */
export function preferredLanguageTags(
  source: LanguagePreferences | undefined | null,
): readonly string[] {
  if (!source) return [];
  const { languages, language } = source;
  if (Array.isArray(languages) && languages.length > 0) return languages;
  return typeof language === 'string' && language.length > 0 ? [language] : [];
}

/**
 * The locale for an environment. Defaults to the ambient `navigator`, so the
 * app calls `detectLocale()` and tests call `detectLocale({ languages: [...] })`
 * without touching a global.
 */
export function detectLocale(
  source: LanguagePreferences | undefined | null = typeof navigator ===
  'undefined'
    ? undefined
    : navigator,
): Locale {
  return matchLocale(preferredLanguageTags(source));
}

/**
 * The string table for a locale.
 *
 * Both tables are typed `Strings`, so either one satisfies a component's copy
 * contract (`ShellStrings`, and whatever later phases add) without narrowing
 * or casting at the call site.
 */
export function stringsFor(locale: Locale): Strings {
  return TABLES[locale];
}

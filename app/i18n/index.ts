/**
 * The i18n layer's public surface.
 *
 * The `en` and `it` tables are deliberately **not** re-exported: application
 * code selects a locale and asks for its table (`stringsFor`), it never names
 * one. `test/unit/locale-boundary.test.ts` enforces that by walking the app's
 * real import graph, so the rule is mechanical rather than remembered.
 * Stories and tests import the tables directly — they are outside that graph
 * and their whole job is to compare the two.
 */
export type { Strings } from './en';
export {
  DEFAULT_LOCALE,
  detectLocale,
  type LanguagePreferences,
  type Locale,
  matchLocale,
  preferredLanguageTags,
  SUPPORTED_LOCALES,
  stringsFor,
} from './locale';

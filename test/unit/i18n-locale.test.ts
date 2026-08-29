import { describe, expect, it } from 'vitest';

import { en } from '../../app/i18n/en';
import { it as itStrings } from '../../app/i18n/it';
import {
  DEFAULT_LOCALE,
  detectLocale,
  matchLocale,
  preferredLanguageTags,
  SUPPORTED_LOCALES,
  stringsFor,
} from '../../app/i18n/locale';

/**
 * FOUN-07's detection rule, asserted tag by tag.
 *
 * The rule (see `app/i18n/locale.ts`): walk the browser's ordered preferences,
 * reduce each tag to its primary language subtag, return the first supported
 * one, and fall back to English when nothing matches.
 */

describe('matchLocale', () => {
  it.each([
    ['it', 'it'],
    ['it-IT', 'it'],
    ['it-CH', 'it'],
    ['IT', 'it'],
    ['it_IT', 'it'],
    ['  it-IT  ', 'it'],
    ['en', 'en'],
    ['en-GB', 'en'],
    ['en-US-POSIX', 'en'],
  ] as const)('%s → %s', (tag, expected) => {
    expect(matchLocale([tag])).toBe(expected);
  });

  it('takes the first supported tag, skipping unsupported ones', () => {
    // A French speaker whose second preference is Italian gets Italian: an
    // unsupported tag must not end the walk, or the fallback would win here.
    expect(matchLocale(['fr-FR', 'it-IT', 'en-GB'])).toBe('it');
    expect(matchLocale(['de-DE', 'en-GB', 'it'])).toBe('en');
  });

  it('prefers earlier tags over later ones', () => {
    expect(matchLocale(['it', 'en'])).toBe('it');
    expect(matchLocale(['en', 'it'])).toBe('en');
  });

  /**
   * The fallback is English, and it is asserted as the literal rather than as
   * `DEFAULT_LOCALE` on both sides — an assertion written against the constant
   * would hold no matter what the constant became.
   */
  it.each([
    'fr-FR',
    'de',
    'es',
    'ita', // ISO 639-2 — not a BCP 47 primary subtag this app knows
    'italiano',
    '',
    '-',
    '   ',
    '-IT',
    'zz-ZZ',
  ])('falls back to English for %o', (tag) => {
    expect(matchLocale([tag])).toBe('en');
  });

  it('falls back to English for no preferences at all', () => {
    expect(matchLocale([])).toBe('en');
    expect(matchLocale(undefined)).toBe('en');
    expect(matchLocale(null)).toBe('en');
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('skips non-string entries without losing a later match', () => {
    const tags = [null, 42, {}, 'it-IT'] as unknown as string[];
    expect(matchLocale(tags)).toBe('it');
  });
});

describe('preferredLanguageTags', () => {
  it('uses navigator.languages when it has entries', () => {
    expect(
      preferredLanguageTags({ languages: ['it-IT', 'en'], language: 'en-GB' }),
    ).toEqual(['it-IT', 'en']);
  });

  it('falls back to navigator.language when languages is absent or empty', () => {
    expect(preferredLanguageTags({ language: 'it-IT' })).toEqual(['it-IT']);
    expect(preferredLanguageTags({ languages: [], language: 'it' })).toEqual([
      'it',
    ]);
  });

  it('reports no preference outside a browser', () => {
    expect(preferredLanguageTags(undefined)).toEqual([]);
    expect(preferredLanguageTags({})).toEqual([]);
    expect(preferredLanguageTags({ language: '' })).toEqual([]);
  });
});

describe('detectLocale', () => {
  it.each([
    [{ languages: ['it-IT', 'it', 'en-US'] }, 'it'],
    [{ languages: ['en-GB', 'it'] }, 'en'],
    [{ languages: ['fr-FR'] }, 'en'],
    [{ languages: ['fr-FR', 'it-CH'] }, 'it'],
    [{ language: 'it-IT' }, 'it'],
    [{ language: 'de-DE' }, 'en'],
    [{}, 'en'],
  ] as const)('%o → %s', (source, expected) => {
    expect(detectLocale(source)).toBe(expected);
  });

  it('returns the default with no navigator at all (the SPA prerender)', () => {
    expect(detectLocale(null)).toBe(DEFAULT_LOCALE);
  });
});

describe('stringsFor', () => {
  it('returns the table matching the locale', () => {
    expect(stringsFor('en')).toBe(en);
    expect(stringsFor('it')).toBe(itStrings);
  });

  it('covers every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(stringsFor(locale))).toEqual(Object.keys(en));
    }
  });

  /**
   * The property the whole feature rests on: resolving Italian must actually
   * produce Italian copy. A resolver hard-wired to `en` — the first mutation
   * in #47's matrix — fails here.
   */
  it('resolves Italian copy for an Italian browser', () => {
    const strings = stringsFor(detectLocale({ languages: ['it-IT'] }));
    expect(strings.nav_overview).toBe('Panoramica');
    expect(strings.shell_nav_label).toBe('Navigazione principale');
    expect(strings.nav_overview).not.toBe(en.nav_overview);
  });
});

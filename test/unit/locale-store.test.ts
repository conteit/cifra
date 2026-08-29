import { describe, expect, it } from 'vitest';

import { en } from '../../app/i18n/en';
import { it as itStrings } from '../../app/i18n/it';
import { createLocaleStore, getLocaleStore } from '../../app/stores/locale';

/**
 * The delivery seam: a store, so a page can read the active table and so the
 * language selector (ACCT-02, #74) can change it without any consumer moving.
 * Plain `zustand/vanilla`, so this suite runs in the Node project with no DOM.
 */

describe('locale store', () => {
  it('starts at the locale it was built with, table in step', () => {
    expect(createLocaleStore('it').getState().locale).toBe('it');
    expect(createLocaleStore('it').getState().strings).toBe(itStrings);
    expect(createLocaleStore('en').getState().strings).toBe(en);
  });

  it('defaults to English when built with nothing', () => {
    expect(createLocaleStore().getState().locale).toBe('en');
  });

  it('swaps locale and table together, and notifies subscribers', () => {
    const store = createLocaleStore('en');
    const seen: string[] = [];
    store.subscribe((state) => seen.push(state.locale));

    store.getState().setLocale('it');

    expect(store.getState().locale).toBe('it');
    expect(store.getState().strings).toBe(itStrings);
    expect(store.getState().strings.nav_overview).toBe('Panoramica');
    expect(seen).toEqual(['it']);
  });

  it('is one instance for the app, so every consumer sees one locale', () => {
    expect(getLocaleStore()).toBe(getLocaleStore());
  });
});

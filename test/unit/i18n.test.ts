import { describe, expect, it } from 'vitest';
import { en } from '../../app/i18n/en';
import { it as itStrings } from '../../app/i18n/it';

describe('i18n locales', () => {
  it('en and it expose identical key sets', () => {
    expect(Object.keys(itStrings).sort()).toEqual(Object.keys(en).sort());
  });

  it('no empty or whitespace-only string values (function values pass explicitly)', () => {
    for (const locale of [en, itStrings]) {
      for (const [key, value] of Object.entries(locale)) {
        const isValid = typeof value === 'function' || value.trim().length > 0;
        expect(isValid, key).toBe(true);
      }
    }
  });
});

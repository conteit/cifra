import { describe, expect, it } from 'vitest';

import { en } from '../../../app/i18n/en';
import { it as itStrings } from '../../../app/i18n/it';
import {
  navItems,
  overflowNavItems,
  primaryNavItems,
} from '../../../app/shell/nav-items';

/**
 * The nav item table is the single source of truth every arrangement of the
 * shell's navigation reads. These are the invariants the arrangements rely on.
 */
describe('nav item table', () => {
  it('carries the seven ported v1 destinations, in the v1 order', () => {
    expect(navItems.map((item) => item.id)).toEqual([
      'overview',
      'transactions',
      'track',
      'wallet',
      'goals',
      'import',
      'account',
    ]);
  });

  it('has unique ids and unique paths', () => {
    expect(new Set(navItems.map((i) => i.id)).size).toBe(navItems.length);
    expect(new Set(navItems.map((i) => i.to)).size).toBe(navItems.length);
  });

  it('names only paths, never relative fragments', () => {
    for (const item of navItems) {
      expect(item.to.startsWith('/'), item.id).toBe(true);
    }
  });

  it('labels every item with a key that exists in both locales', () => {
    for (const item of navItems) {
      expect(item.labelKey, item.id).toBe(`nav_${item.id}`);
      expect(typeof en[item.labelKey], item.labelKey).toBe('string');
      expect(typeof itStrings[item.labelKey], item.labelKey).toBe('string');
    }
  });

  it('gives every item a decorative glyph', () => {
    for (const item of navItems) {
      expect(item.glyph.length, item.id).toBeGreaterThan(0);
    }
  });

  /**
   * The mobile bottom bar has five slots (v1's `.bottom-nav`). Four go to
   * primary destinations and the fifth to the overflow control, so the primary
   * set must stay at four — a fifth would push the overflow control out and
   * strand Goals, Import and Account on mobile.
   */
  it('marks exactly the leading four destinations as bottom-bar primaries', () => {
    expect(primaryNavItems(navItems).map((i) => i.id)).toEqual([
      'overview',
      'transactions',
      'track',
      'wallet',
    ]);
  });

  it('routes everything else through the overflow sheet', () => {
    expect(overflowNavItems(navItems).map((i) => i.id)).toEqual([
      'goals',
      'import',
      'account',
    ]);
  });

  it('splits the table exhaustively — nothing is unreachable on mobile', () => {
    const reachable = [
      ...primaryNavItems(navItems),
      ...overflowNavItems(navItems),
    ].map((i) => i.id);
    expect(reachable.sort()).toEqual(navItems.map((i) => i.id).sort());
  });
});

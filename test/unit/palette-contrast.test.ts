import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Makes the palette's WCAG contrast floor self-policing (D16).
 *
 * Issue #45 found `--ramp-sepia-500` at 3.95:1 on the page and
 * `--ramp-amber-600` at 2.87:1 — both below the AA floor for the 8.5px and
 * 17px roles the type scale actually uses them at. axe caught it only because
 * the tokens story happens to paint those tokens; a pigment that no story
 * renders as text would have shipped broken, and re-lightening one later would
 * pass every check we had.
 *
 * This suite closes that hole. It reads the token values out of `app/app.css`
 * itself, resolves the `var()` chains from the raw ramp to the semantic alias,
 * and asserts the WCAG 2.x contrast ratio for every foreground/background pair
 * the design system permits. It is a node-environment test: the values are
 * static CSS, so no browser and no Playwright are needed. Storybook's axe pass
 * still checks live pixels; this checks the *contract*, including pairs no
 * story renders yet.
 *
 * Two rules make it a contract rather than a snapshot:
 *
 *   1. PERMITTED enumerates which surfaces each foreground may sit on. It is
 *      the design system's statement of intent, not a list drawn around the
 *      numbers — see the surface comments in `app/app.css`.
 *   2. The exhaustiveness test fails if a new `--color-text-*`,
 *      `--color-accent-*` or `--color-category-*` token is added without a
 *      line in PERMITTED, so the matrix cannot quietly fall behind the theme.
 */

const cssPath = fileURLToPath(new URL('../../app/app.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

/* ── Token resolution ───────────────────────────────────────────────────── */

/** Every `--name: value;` declaration in the sheet, comments stripped. */
function declarations(source: string): Map<string, string> {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  for (const match of withoutComments.matchAll(
    /(--[a-z0-9-]+)\s*:\s*([^;]+);/g,
  )) {
    out.set(match[1], match[2].trim());
  }
  return out;
}

const tokens = declarations(css);

/** Follows `var(--x)` chains down to a literal value. */
function resolve(name: string, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`circular token reference at ${name}`);
  seen.add(name);
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`unknown token ${name}`);
  const indirection = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value);
  return indirection ? resolve(indirection[1], seen) : value;
}

/* ── WCAG 2.x relative luminance and contrast ───────────────────────────── */

function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`not an opaque hex colour: ${hex}`);
  const int = Number.parseInt(match[1], 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* ── The permitted pairs ────────────────────────────────────────────────── */

const AA_TEXT = 4.5; // WCAG 1.4.3, body-size text
const NON_TEXT = 3; // WCAG 1.4.11, graphical objects

/** Content surfaces: any text token may be placed on these. */
const TEXT_SURFACES = [
  '--color-surface-page',
  '--color-surface-card',
  '--color-surface-inset',
] as const;

type Pair = {
  /** The foreground token. */
  fg: string;
  /** Backgrounds it is permitted to sit on. */
  on: readonly string[];
  /** 4.5:1 for text, 3:1 for tokens that are only ever drawn as graphics. */
  min: number;
  /** Why this token's permitted set is what it is. */
  note: string;
};

/** The wash each money accent is paired with for chips and badges. */
const accentWash = (name: string) => `--color-accent-${name}-surface`;
const categoryWash = (name: string) => `--color-category-${name}-surface`;

const CATEGORIES = [
  'groceries',
  'housing',
  'transport',
  'dining',
  'subscriptions',
  'health',
  'sport',
  'utilities',
  'bar',
  'other',
] as const;

const PERMITTED: Pair[] = [
  {
    fg: '--color-text-primary',
    // `surface-track` is a graphic surface, but the secondary button's hover
    // fill uses it under `text-secondary`, and the ink tokens clear AA there.
    on: [...TEXT_SURFACES, '--color-surface-track'],
    min: AA_TEXT,
    note: 'body copy and numerals, anywhere',
  },
  {
    fg: '--color-text-secondary',
    on: [...TEXT_SURFACES, '--color-surface-track'],
    min: AA_TEXT,
    note: 'supporting copy; the secondary button hover puts it on track',
  },
  {
    fg: '--color-text-muted',
    on: TEXT_SURFACES,
    min: AA_TEXT,
    note: 'labels and disabled input text; never on a progress track',
  },
  {
    fg: '--color-text-meta',
    on: TEXT_SURFACES,
    min: AA_TEXT,
    note: 'units and timestamps at text-label-sm; never on a progress track',
  },
  {
    fg: '--color-text-inverse',
    on: ['--color-surface-inverse'],
    min: AA_TEXT,
    note: 'copy on the dark hero panel',
  },
  {
    fg: '--color-action-on-primary',
    on: ['--color-action-primary', '--color-action-primary-hover'],
    min: AA_TEXT,
    note: 'the primary button label, at rest and on hover',
  },
  {
    fg: '--color-accent-income',
    on: [...TEXT_SURFACES, accentWash('income')],
    min: AA_TEXT,
    note: 'income amounts and their badge',
  },
  {
    fg: '--color-accent-income-strong',
    on: [...TEXT_SURFACES, '--color-surface-track', accentWash('income')],
    min: NON_TEXT,
    note: 'D17: bars, chart series and fills only — never drawn as text',
  },
  {
    fg: '--color-accent-spend',
    on: [...TEXT_SURFACES, accentWash('spend')],
    min: AA_TEXT,
    note: 'spend amounts, errors and their badge',
  },
  {
    fg: '--color-accent-planned',
    on: [...TEXT_SURFACES, accentWash('planned')],
    min: AA_TEXT,
    note: 'every planned/forecast amount and its badge',
  },
  {
    fg: '--color-accent-cash',
    on: [...TEXT_SURFACES, accentWash('cash')],
    min: AA_TEXT,
    note: 'cash-wallet amounts and their badge',
  },
  // The accent washes double as text on the dark hero panel (the income and
  // spend figures in the tokens sheet's specimen).
  ...(['income', 'spend', 'planned', 'cash'] as const).map((name) => ({
    fg: accentWash(name),
    on: ['--color-surface-inverse'],
    min: AA_TEXT,
    note: 'wash used as a figure colour on the dark hero panel',
  })),
  // Category colours are drawn as chip labels on their own wash, and as text
  // on the page and on cards.
  ...CATEGORIES.map((name) => ({
    fg: `--color-category-${name}`,
    on: [...TEXT_SURFACES, categoryWash(name)],
    min: AA_TEXT,
    note: 'category chip label, dot and inline text',
  })),
];

/* ── Tests ──────────────────────────────────────────────────────────────── */

describe('palette contrast (D16)', () => {
  describe.each(PERMITTED)('$fg — $note', ({ fg, on, min }) => {
    const foreground = resolve(fg);

    it.each(on)(`on %s is at least ${min}:1`, (bg) => {
      const background = resolve(bg);
      const ratio = contrast(foreground, background);
      expect(
        Number(ratio.toFixed(2)),
        `${fg} ${foreground} on ${bg} ${background} is ${ratio.toFixed(2)}:1, below ${min}:1`,
      ).toBeGreaterThanOrEqual(min);
    });
  });

  it('covers every colour token that can be drawn as a foreground', () => {
    // Every text, accent and category token is a foreground somewhere. The
    // category washes are the one exception: they are only ever a fill.
    const declared = [...tokens.keys()]
      .filter((name) =>
        /^--color-(text|accent|category)-|^--color-action-on-/.test(name),
      )
      .filter((name) => !/^--color-category-.+-surface$/.test(name))
      .sort();
    const covered = [...new Set(PERMITTED.map((pair) => pair.fg))].sort();

    expect(covered).toEqual(declared);
  });

  it('resolves the two pigments issue #45 repainted', () => {
    // Pins the fix itself: re-lightening either ramp fails here as well as in
    // the pair matrix, and names the issue in the failure.
    expect(resolve('--color-text-meta')).toBe('#7b6346');
    expect(resolve('--color-accent-planned')).toBe('#876000');
    expect(resolve('--color-category-utilities')).toBe('#876000');
    expect(resolve('--color-accent-spend')).toBe('#bf3326');
    expect(resolve('--color-category-health')).toBe('#bf3326');
  });
});
